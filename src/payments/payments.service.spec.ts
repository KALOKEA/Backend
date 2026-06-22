/**
 * PaymentsService unit tests — critical paths:
 *   • verifyPayment: valid HMAC signature → verified: true
 *   • verifyPayment: tampered signature → throws BadRequestException
 *   • verifyPayment: idempotent — already-paid order skips DB update
 *   • handleWebhook: invalid webhook signature → throws BadRequestException
 *   • handleWebhook: payment.captured event → marks order paid (first delivery)
 *   • handleWebhook: payment.captured duplicate → idempotent (already paid)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { DatabaseService } from '../database/database.service';
import { ConfigService } from '@nestjs/config';
import { GstService } from '../gst/gst.service';
import { OrdersService } from '../orders/orders.service';
import { EmailService } from '../email/email.service';
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeHmac(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function makeRawBodyRequest(body: object, signature: string) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    headers: { 'x-razorpay-signature': signature },
    rawBody,
  } as any;
}

// ─── mocks ──────────────────────────────────────────────────────────────────

const mockDbClient = { from: jest.fn() };
const mockDb: Partial<DatabaseService> = { client: mockDbClient as any };

const WEBHOOK_SECRET = 'wh-secret-123';
const RAZORPAY_KEY_SECRET = 'key-secret-xyz';

const mockConfig: Partial<ConfigService> = {
  get: jest.fn((key: string) => {
    if (key === 'RAZORPAY_WEBHOOK_SECRET') return WEBHOOK_SECRET;
    if (key === 'RAZORPAY_KEY_SECRET') return RAZORPAY_KEY_SECRET;
    if (key === 'RAZORPAY_KEY_ID') return 'rzp_test_key';
    return undefined;
  }),
};

const mockGst: Partial<GstService>       = { postSaleLedger: jest.fn().mockResolvedValue(undefined) };
const mockOrders: Partial<OrdersService> = { sendConfirmationEmails: jest.fn().mockResolvedValue(undefined) };
const mockEmail: Partial<EmailService>   = {
  sendRefundProcessed: jest.fn().mockResolvedValue(undefined),
  sendPaymentFailed: jest.fn().mockResolvedValue(undefined),
};

// ─── setup ──────────────────────────────────────────────────────────────────

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: ConfigService, useValue: mockConfig },
        { provide: GstService, useValue: mockGst },
        { provide: OrdersService, useValue: mockOrders },
        { provide: EmailService, useValue: mockEmail },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  // ─── verifyPayment ────────────────────────────────────────────────────────

  describe('verifyPayment', () => {
    const razorpay_order_id = 'order_abc123';
    const razorpay_payment_id = 'pay_xyz789';
    const validSignature = makeHmac(
      RAZORPAY_KEY_SECRET,
      `${razorpay_order_id}|${razorpay_payment_id}`,
    );

    it('throws BadRequest on tampered signature', async () => {
      await expect(
        service.verifyPayment({
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature: 'deadbeef'.repeat(8),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns verified:true on valid signature and marks order paid', async () => {
      const fakeOrder = {
        id: 'order-uuid-1',
        order_number: 'KLK-001',
        payment_status: 'pending',
        order_items: [{ variant_id: 'v1', quantity: 2 }],
      };

      mockDbClient.from.mockImplementation((table: string) => {
        const q: any = {};
        const noop = () => q;
        q.select = noop; q.eq = noop; q.update = noop;
        q.maybeSingle = jest.fn().mockResolvedValue({ data: fakeOrder });
        // update chain
        q.then = (onF: any) => Promise.resolve({ data: {}, error: null }).then(onF);
        if (table === 'stock_reservations') {
          q.eq = noop;
          q.then = (onF: any) => Promise.resolve({}).then(onF);
        }
        // decrement_stock rpc
        q.rpc = jest.fn().mockResolvedValue({ data: true });
        return q;
      });

      // Mock the decrement_stock RPC at the client level
      (mockDbClient as any).rpc = jest.fn().mockResolvedValue({ data: true });

      const result = await service.verifyPayment({
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature: validSignature,
      });

      expect(result).toEqual({ verified: true });
    });

    it('is idempotent — skips update when order already paid', async () => {
      const alreadyPaid = {
        id: 'order-uuid-2',
        order_number: 'KLK-002',
        payment_status: 'paid',
        order_items: [],
      };

      mockDbClient.from.mockImplementation(() => {
        const q: any = {};
        const noop = () => q;
        q.select = noop; q.eq = noop; q.update = noop;
        q.maybeSingle = jest.fn().mockResolvedValue({ data: alreadyPaid });
        return q;
      });

      const result = await service.verifyPayment({
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature: validSignature,
      });

      expect(result).toEqual({ verified: true });
      // update() should never have been called for a paid order
      // (the mock's update noop is the same ref, so we check gst was NOT called)
      expect(mockGst.postSaleLedger).not.toHaveBeenCalled();
    });
  });

  // ─── handleWebhook ────────────────────────────────────────────────────────

  describe('handleWebhook', () => {
    it('throws BadRequest on invalid webhook signature', async () => {
      const body = { event: 'payment.captured' };
      const req = makeRawBodyRequest(body, 'bad-sig');
      await expect(service.handleWebhook(req)).rejects.toThrow(BadRequestException);
    });

    it('marks order paid on payment.captured (first delivery)', async () => {
      const payload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: { id: 'pay_new', order_id: 'order_abc' },
          },
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
      const req = { headers: { 'x-razorpay-signature': sig }, rawBody } as any;

      const pendingOrder = {
        id: 'ord-1',
        order_number: 'KLK-100',
        payment_status: 'pending',
        order_items: [{ variant_id: 'v1', quantity: 1, snapshot_name: 'Dress', snapshot_price: 100 }],
        users: { email: 'u@x.com', name: 'User' },
      };

      mockDbClient.from.mockImplementation((table: string) => {
        const q: any = {};
        const noop = () => q;
        q.select = noop; q.eq = noop; q.update = noop; q.delete = noop;
        q.single = jest.fn().mockResolvedValue({ data: pendingOrder });
        q.then = (onF: any) => Promise.resolve({}).then(onF);
        if (table === 'stock_reservations') {
          q.eq = noop;
          q.then = (onF: any) => Promise.resolve({}).then(onF);
        }
        return q;
      });
      (mockDbClient as any).rpc = jest.fn().mockResolvedValue({ data: true });

      const result = await service.handleWebhook(req);
      expect(result).toEqual({ received: true });
      expect(mockOrders.sendConfirmationEmails).toHaveBeenCalledWith('ord-1');
    });

    it('is idempotent — skips re-processing for already-paid order', async () => {
      const payload = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_dup', order_id: 'order_dup' } } },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
      const req = { headers: { 'x-razorpay-signature': sig }, rawBody } as any;

      const paidOrder = {
        id: 'ord-2',
        order_number: 'KLK-101',
        payment_status: 'paid', // already paid
        order_items: [],
        users: { email: 'u@x.com', name: 'User' },
      };

      mockDbClient.from.mockImplementation(() => {
        const q: any = {};
        const noop = () => q;
        q.select = noop; q.eq = noop; q.update = noop;
        q.single = jest.fn().mockResolvedValue({ data: paidOrder });
        return q;
      });

      await service.handleWebhook(req);
      expect(mockGst.postSaleLedger).not.toHaveBeenCalled();
      expect(mockOrders.sendConfirmationEmails).not.toHaveBeenCalled();
    });
  });

  // ─── payment.failed tests ─────────────────────────────────────────────────

  describe('handleWebhook — payment.failed', () => {
    it('marks order as failed and sends sendPaymentFailed email', async () => {
      const failedOrder = {
        id: 'ord-f1',
        order_number: 'KLK-FAIL-001',
        total: 150000,
        guest_email: null,
        users: { email: 'customer@test.com', name: 'Customer Name' },
      };
      const payload = {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: { id: 'pay_fail_1', order_id: 'rp_order_1', amount: 150000 },
          },
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = makeHmac(WEBHOOK_SECRET, rawBody.toString());
      const req = { headers: { 'x-razorpay-signature': sig }, rawBody } as any;

      mockDbClient.from.mockImplementation((table: string) => {
        const q: any = {};
        const noop = () => q;
        q.update = jest.fn().mockReturnThis();
        q.eq = jest.fn().mockReturnThis();
        q.select = jest.fn().mockReturnThis();
        q.delete = jest.fn().mockReturnThis();
        q.single = jest.fn().mockResolvedValue({ data: failedOrder });
        q.then = (onF: any) => Promise.resolve({}).then(onF);
        return q;
      });

      const result = await service.handleWebhook(req);
      expect(result).toEqual({ received: true });
      expect(mockEmail.sendPaymentFailed).toHaveBeenCalledWith(
        'customer@test.com',
        expect.objectContaining({
          customer_name: 'Customer Name',
          order_id: 'KLK-FAIL-001',
          amount: 150000,
        }),
      );
    });

    it('sends to guest_email when no registered user', async () => {
      const failedGuestOrder = {
        id: 'ord-fg1',
        order_number: 'KLK-GFAIL-001',
        total: 80000,
        guest_email: 'guest@test.com',
        users: null,
      };
      const payload = {
        event: 'payment.failed',
        payload: {
          payment: { entity: { id: 'pay_g1', order_id: 'rp_g1', amount: 80000 } },
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = makeHmac(WEBHOOK_SECRET, rawBody.toString());
      const req = { headers: { 'x-razorpay-signature': sig }, rawBody } as any;

      mockDbClient.from.mockImplementation(() => {
        const q: any = {};
        const noop = () => q;
        q.update = jest.fn().mockReturnThis();
        q.eq = jest.fn().mockReturnThis();
        q.select = jest.fn().mockReturnThis();
        q.delete = jest.fn().mockReturnThis();
        q.single = jest.fn().mockResolvedValue({ data: failedGuestOrder });
        q.then = (onF: any) => Promise.resolve({}).then(onF);
        return q;
      });

      await service.handleWebhook(req);
      expect(mockEmail.sendPaymentFailed).toHaveBeenCalledWith(
        'guest@test.com',
        expect.objectContaining({ customer_name: 'Customer' }),
      );
    });

    it('releases stock reservations on payment.failed', async () => {
      const failedOrder = {
        id: 'ord-f2',
        order_number: 'KLK-FAIL-002',
        total: 50000,
        guest_email: 'x@test.com',
        users: null,
      };
      const payload = {
        event: 'payment.failed',
        payload: { payment: { entity: { id: 'pay_f2', order_id: 'rp_f2', amount: 50000 } } },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = makeHmac(WEBHOOK_SECRET, rawBody.toString());
      const req = { headers: { 'x-razorpay-signature': sig }, rawBody } as any;

      const deleteMock = jest.fn().mockReturnThis();
      const eqMock = jest.fn().mockReturnThis();

      mockDbClient.from.mockImplementation((table: string) => {
        const q: any = {};
        q.update = jest.fn().mockReturnThis();
        q.eq = eqMock;
        q.select = jest.fn().mockReturnThis();
        q.single = jest.fn().mockResolvedValue({ data: failedOrder });
        q.delete = deleteMock;
        q.then = (onF: any) => Promise.resolve({}).then(onF);
        return q;
      });

      await service.handleWebhook(req);
      // stock_reservations.delete().eq('order_id', ...) should have been called
      expect(deleteMock).toHaveBeenCalled();
    });
  });
});
