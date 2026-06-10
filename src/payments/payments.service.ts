import { Injectable, BadRequestException, NotFoundException, Logger, RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { GstService } from '../gst/gst.service';
import { OrdersService } from '../orders/orders.service';
import { EmailService } from '../email/email.service';
import { RefundDto } from './dto/refund.dto';
import * as crypto from 'crypto';
import { Request } from 'express';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private gst: GstService,
    private orders: OrdersService,
    private email: EmailService,
  ) {}

  /**
   * Refund an order (admin). For prepaid (Razorpay) orders this calls the
   * Razorpay refund API against the captured payment; for COD it records a
   * manual refund (admin settles cash/UPI offline). Marks the order refunded
   * and emails the customer. Amount defaults to the returned line's value
   * (when return_id is given) or the full order total. Idempotent: a second
   * call on an already-refunded order is a no-op.
   *
   * NOTE: the GST credit-note / restock is driven by the RETURN moving to
   * 'refunded' (ReturnsService) — the admin UI does both, so do not duplicate
   * the ledger reversal here.
   */
  async refund(dto: RefundDto) {
    const { data: order } = await this.db.client
      .from('orders')
      .select('*, users(email, name)')
      .eq('id', dto.order_id)
      .single();
    if (!order) throw new NotFoundException('Order not found');

    if (order.payment_status === 'refunded') {
      return { refunded: true, already: true, amount: 0 };
    }
    if (order.payment_status !== 'paid' && order.payment_method !== 'cod') {
      throw new BadRequestException('Only paid orders can be refunded');
    }

    // Resolve the refund amount (paise).
    let amount = dto.amount;
    if (!amount && dto.return_id) {
      const { data: ret } = await this.db.client
        .from('returns').select('order_item_id').eq('id', dto.return_id).single();
      if (ret?.order_item_id) {
        const { data: oi } = await this.db.client
          .from('order_items').select('taxable_value, gst_amount').eq('id', ret.order_item_id).single();
        if (oi) amount = (Number(oi.taxable_value) || 0) + (Number(oi.gst_amount) || 0);
      }
    }
    if (!amount || amount <= 0) amount = Number(order.total) || 0;
    amount = Math.min(amount, Number(order.total) || 0);

    let method = 'Manual (COD)';
    // Prepaid → hit Razorpay's refund API.
    if (order.payment_method !== 'cod' && order.razorpay_payment_id) {
      const keyId = this.config.get('RAZORPAY_KEY_ID');
      const keySecret = this.config.get('RAZORPAY_KEY_SECRET');
      const res = await fetch(
        `https://api.razorpay.com/v1/payments/${order.razorpay_payment_id}/refund`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
          },
          body: JSON.stringify({ amount: Math.round(amount) }),
        },
      );
      const result: any = await res.json();
      if (!res.ok) {
        this.logger.error(`Razorpay refund failed: ${JSON.stringify(result)}`);
        throw new BadRequestException(result.error?.description || 'Razorpay refund failed');
      }
      method = 'Razorpay';
    }

    await this.db.client.from('orders')
      .update({ payment_status: 'refunded', status: 'refunded' })
      .eq('id', order.id);

    const to = order.guest_email || (order.users as any)?.email;
    if (to) {
      await this.email.sendRefundProcessed(to, {
        customer_name: (order.users as any)?.name || (order.address_snapshot as any)?.name || 'Customer',
        order_id: order.order_number,
        refund_amount: amount,
        method,
      });
    }

    return { refunded: true, amount, method };
  }

  async createRazorpayOrder(orderId: string, userId?: string) {
    const keyId = this.config.get('RAZORPAY_KEY_ID');
    const keySecret = this.config.get('RAZORPAY_KEY_SECRET');

    if (!keyId || !keySecret) {
      this.logger.error('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set in environment');
      throw new BadRequestException('Payment gateway is not configured. Please contact support.');
    }

    const { data: order } = await this.db.client
      .from('orders').select('*').eq('id', orderId).single();
    if (!order) throw new BadRequestException('Order not found');

    // Ownership check (SEC-1): authenticated users may only pay for their own orders.
    // Guests (userId undefined) are permitted — they can't be linked to a user_id.
    if (userId && order.user_id && order.user_id !== userId) {
      throw new BadRequestException('Order not found');
    }

    const amount = Math.round(order.total); // order.total is already stored in paise (Razorpay's unit)

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ amount, currency: 'INR', receipt: order.order_number }),
    });

    const razorpayOrder: any = await response.json();
    if (!response.ok) throw new BadRequestException(razorpayOrder.error?.description || 'Razorpay error');

    await this.db.client.from('orders')
      .update({ razorpay_order_id: razorpayOrder.id })
      .eq('id', orderId);

    return {
      razorpay_order_id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key_id: keyId,
    };
  }

  /**
   * Client-side payment verification. Called by the frontend Razorpay handler()
   * callback before showing the success page. Verifies the Razorpay signature
   * using HMAC-SHA256 so a failed payment can never show the success screen.
   *
   * Razorpay signs: `razorpay_order_id + '|' + razorpay_payment_id`
   */
  async verifyPayment(dto: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET');
    if (!keySecret) throw new BadRequestException('Payment gateway not configured');

    const body = `${dto.razorpay_order_id}|${dto.razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(body)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    const providedBuf = Buffer.from(dto.razorpay_signature || '', 'hex');

    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      this.logger.warn(`Invalid Razorpay payment signature for order ${dto.razorpay_order_id}`);
      throw new BadRequestException('Payment verification failed. Please contact support.');
    }

    // Signature is valid — flip the order to paid as a fallback for when the
    // Razorpay webhook is delayed or never arrives (network partition, mis-config).
    // The webhook handler is idempotent (checks payment_status !== 'paid'), so
    // a subsequent webhook delivery after this runs is safe and a no-op.
    const { data: order } = await this.db.client
      .from('orders')
      .select('id, order_number, payment_status, order_items(variant_id, quantity)')
      .eq('razorpay_order_id', dto.razorpay_order_id)
      .maybeSingle();

    if (order && order.payment_status !== 'paid') {
      await this.db.client.from('orders').update({
        payment_status: 'paid',
        status: 'confirmed',
        razorpay_payment_id: dto.razorpay_payment_id,
      }).eq('id', order.id);

      // Post GST ledger entry for this sale.
      await this.gst.postSaleLedger(order.id).catch((e) =>
        this.logger.warn(`GST ledger fallback failed for ${order.id}: ${e.message}`),
      );

      // Deduct stock (same guard as webhook — if short, log for manual review).
      for (const item of (order.order_items as any[]) || []) {
        const { data: ok } = await this.db.client.rpc('decrement_stock', {
          p_variant_id: item.variant_id,
          p_qty: item.quantity,
        });
        if (ok !== true) {
          this.logger.warn(`Stock shortfall (verifyPayment fallback) for variant ${item.variant_id} on order ${order.order_number}`);
        }
      }

      // Confirm soft reservations.
      // Use two-arg .then() because Supabase returns PromiseLike (no .catch()).
      void this.db.client
        .from('stock_reservations')
        .update({ confirmed: true })
        .eq('order_id', order.id)
        .then(() => {}, () => {});
    }

    return { verified: true };
  }

  async handleWebhook(req: RawBodyRequest<Request>) {
    const webhookSecret = this.config.get<string>('RAZORPAY_WEBHOOK_SECRET');
    if (!webhookSecret) {
      this.logger.error('RAZORPAY_WEBHOOK_SECRET is not set — rejecting webhook');
      throw new BadRequestException('Webhook not configured');
    }
    const signature = req.headers['x-razorpay-signature'] as string;
    const rawBody = req.rawBody;

    if (!rawBody) throw new BadRequestException('No raw body');

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison to avoid signature timing attacks.
    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    const providedBuf = Buffer.from(signature || '', 'hex');
    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      this.logger.warn('Invalid Razorpay webhook signature');
      throw new BadRequestException('Invalid signature');
    }

    const payload = JSON.parse(rawBody.toString());
    const event = payload.event;

    if (event === 'payment.captured') {
      const payment = payload.payload.payment.entity;
      const razorpayOrderId = payment.order_id;

      const { data: order } = await this.db.client
        .from('orders')
        .select('*, users(email, name), order_items(variant_id, quantity, snapshot_name, snapshot_price)')
        .eq('razorpay_order_id', razorpayOrderId)
        .single();

      // Idempotency: Razorpay can deliver the same webhook more than once.
      // Only confirm + deduct stock on the FIRST transition to paid, so stock
      // is never double-decremented on a duplicate delivery.
      if (order && order.payment_status !== 'paid') {
        await this.db.client.from('orders').update({
          payment_status: 'paid',
          status: 'confirmed',
          razorpay_payment_id: payment.id,
        }).eq('id', order.id);

        // Record the sale in the GST ledger (online orders post here, not at
        // creation — only a captured payment is a committed taxable sale).
        await this.gst.postSaleLedger(order.id);

        // Deduct stock now that payment is captured (online orders skip the
        // decrement at order creation — see OrdersService.createOrder). Atomic
        // and guarded; if a rare race left it short, log it for manual review
        // (the customer has already paid, so we don't drive stock negative).
        for (const item of (order.order_items as any[]) || []) {
          const { data: ok } = await this.db.client.rpc('decrement_stock', {
            p_variant_id: item.variant_id,
            p_qty: item.quantity,
          });
          if (ok !== true) {
            this.logger.warn(`Stock shortfall on paid order ${order.order_number} for variant ${item.variant_id} — manual review needed`);
          }
        }

        // Confirm the soft-reservation so it's no longer counted as "pending"
        // by get_soft_reserved(). This is a no-op if migration 008 hasn't run.
        Promise.resolve(
          this.db.client
            .from('stock_reservations')
            .update({ confirmed: true })
            .eq('order_id', order.id),
        ).catch(() => {});

        // Booking confirmation + GST receipt + tax invoice to the customer,
        // plus admin alert (single source of truth in OrdersService).
        await this.orders.sendConfirmationEmails(order.id);
      }
    }

    if (event === 'payment.failed') {
      const payment = payload.payload.payment.entity;
      const { data: failedOrder } = await this.db.client
        .from('orders')
        .update({ payment_status: 'failed' })
        .eq('razorpay_order_id', payment.order_id)
        .select('id, order_number, total, guest_email, users(email, name)')
        .single();

      // Release soft-reservations so other buyers can purchase the items.
      if (failedOrder?.id) {
        Promise.resolve(
          this.db.client
            .from('stock_reservations')
            .delete()
            .eq('order_id', failedOrder.id),
        ).catch(() => {});
      }

      if (failedOrder) {
        // Notify both logged-in users AND guests (guest_email was missing — GE-1).
        const userEmail = (failedOrder.users as any)?.email || failedOrder.guest_email;
        if (userEmail) {
          await this.email.sendPaymentFailed(userEmail, {
            customer_name: (failedOrder.users as any)?.name || 'Customer',
            order_id: failedOrder.order_number,
            amount: failedOrder.total,
          }).catch(() => {});
        }
      }
    }

    return { received: true };
  }
}
