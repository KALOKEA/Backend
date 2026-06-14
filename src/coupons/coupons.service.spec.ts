/**
 * CouponsService unit tests — critical paths:
 *   • validate: not found / inactive → NotFoundException
 *   • validate: expired coupon → BadRequestException
 *   • validate: usage limit reached → BadRequestException
 *   • validate: per-user limit reached → BadRequestException
 *   • validate: below min_order_value → BadRequestException
 *   • validate: percent coupon → correct discount (capped at order value)
 *   • validate: flat coupon → correct discount (capped at order value)
 *   • validate: flat coupon never discounts more than order value
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CouponsService } from './coupons.service';
import { DatabaseService } from '../database/database.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

// ─── helpers ────────────────────────────────────────────────────────────────

function buildDbMock(overrides: {
  coupon?: any;
  usageCount?: number;
}) {
  const { coupon = null, usageCount = 0 } = overrides;

  const mockDbClient = {
    from: jest.fn().mockImplementation((table: string) => {
      const q: any = {};
      const noop = () => q;
      q.select = noop;
      q.eq = noop;
      q.is = noop;
      q.order = noop;
      q.limit = noop;
      q.insert = noop;
      q.update = noop;
      q.rpc = jest.fn().mockResolvedValue({ data: true });

      if (table === 'coupons') {
        q.single = jest.fn().mockResolvedValue({ data: coupon, error: coupon ? null : { message: 'not found' } });
      } else if (table === 'coupon_uses') {
        // .select('id', { count: 'exact', head: true }) returns { count }
        q.select = jest.fn().mockReturnThis();
        q.then = (_: any, __: any) =>
          Promise.resolve({ count: usageCount, error: null });
      }
      return q;
    }),
  };

  return { client: mockDbClient } as any;
}

// ─── setup ──────────────────────────────────────────────────────────────────

describe('CouponsService', () => {
  async function makeService(dbMock: DatabaseService) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponsService,
        { provide: DatabaseService, useValue: dbMock },
      ],
    }).compile();
    return module.get<CouponsService>(CouponsService);
  }

  // ─── not found ────────────────────────────────────────────────────────────

  it('throws NotFoundException when coupon does not exist', async () => {
    const service = await makeService(buildDbMock({ coupon: null }));
    await expect(service.validate({ code: 'FAKE', order_value: 100000 }))
      .rejects.toThrow(NotFoundException);
  });

  // ─── expired ──────────────────────────────────────────────────────────────

  it('throws BadRequestException when coupon is expired', async () => {
    const expired = {
      id: 'c1', code: 'EXPIRED', type: 'flat', value: 10000, is_active: true,
      valid_until: new Date(Date.now() - 1000).toISOString(), // past
      min_order_value: 0, max_uses: null, used_count: 0, max_per_user: null,
    };
    const service = await makeService(buildDbMock({ coupon: expired }));
    await expect(service.validate({ code: 'EXPIRED', order_value: 100000 }))
      .rejects.toThrow(/expired/i);
  });

  // ─── usage limit ──────────────────────────────────────────────────────────

  it('throws BadRequestException when global usage limit is reached', async () => {
    const exhausted = {
      id: 'c2', code: 'FULL', type: 'flat', value: 5000, is_active: true,
      valid_until: null, min_order_value: 0,
      max_uses: 100, used_count: 100, // at limit
      max_per_user: null,
    };
    const service = await makeService(buildDbMock({ coupon: exhausted }));
    await expect(service.validate({ code: 'FULL', order_value: 100000 }))
      .rejects.toThrow(/usage limit/i);
  });

  // ─── per-user limit ───────────────────────────────────────────────────────

  it('throws BadRequestException when per-user limit is reached', async () => {
    const limited = {
      id: 'c3', code: 'ONCE', type: 'flat', value: 5000, is_active: true,
      valid_until: null, min_order_value: 0,
      max_uses: null, used_count: 0,
      max_per_user: 1,
    };
    // usageCount = 1 means this user already used it
    const service = await makeService(buildDbMock({ coupon: limited, usageCount: 1 }));
    await expect(service.validate({ code: 'ONCE', order_value: 100000, user_id: 'user-1' }))
      .rejects.toThrow(/can only be used 1 time/i);
  });

  // ─── min order value ──────────────────────────────────────────────────────

  it('throws BadRequestException when order is below minimum', async () => {
    const minCoupon = {
      id: 'c4', code: 'MIN500', type: 'flat', value: 5000, is_active: true,
      valid_until: null, min_order_value: 50000, // ₹500 minimum
      max_uses: null, used_count: 0, max_per_user: null,
    };
    const service = await makeService(buildDbMock({ coupon: minCoupon }));
    await expect(service.validate({ code: 'MIN500', order_value: 30000 })) // ₹300
      .rejects.toThrow(/minimum order/i);
  });

  // ─── percent coupon ───────────────────────────────────────────────────────

  it('applies correct percent discount', async () => {
    const pct = {
      id: 'c5', code: 'SAVE10', type: 'percent', value: 10, is_active: true,
      valid_until: null, min_order_value: 0,
      max_uses: null, used_count: 0, max_per_user: null,
    };
    const service = await makeService(buildDbMock({ coupon: pct }));
    const result = await service.validate({ code: 'SAVE10', order_value: 100000 }); // ₹1000
    // 10% of ₹1000 = ₹100 = 10000 paise
    expect(result.discount).toBe(10000);
    expect(result.valid).toBe(true);
  });

  // ─── flat coupon ──────────────────────────────────────────────────────────

  it('applies correct flat discount', async () => {
    const flat = {
      id: 'c6', code: 'FLAT100', type: 'flat', value: 10000, is_active: true,
      valid_until: null, min_order_value: 0,
      max_uses: null, used_count: 0, max_per_user: null,
    };
    const service = await makeService(buildDbMock({ coupon: flat }));
    const result = await service.validate({ code: 'FLAT100', order_value: 50000 });
    expect(result.discount).toBe(10000); // ₹100
  });

  // ─── discount capping ─────────────────────────────────────────────────────

  it('never discounts more than the order value', async () => {
    const big = {
      id: 'c7', code: 'BIG', type: 'flat', value: 200000, is_active: true,
      valid_until: null, min_order_value: 0,
      max_uses: null, used_count: 0, max_per_user: null,
    };
    const service = await makeService(buildDbMock({ coupon: big }));
    const order_value = 50000; // ₹500 — less than coupon value
    const result = await service.validate({ code: 'BIG', order_value });
    expect(result.discount).toBe(order_value); // capped
  });
});

// ─── redeem() — atomic RPC ───────────────────────────────────────────────────

describe('CouponsService.redeem()', () => {
  async function makeServiceWithRpc(rpcReturn: { data: any; error: any }) {
    const rpcMock = jest.fn().mockResolvedValue(rpcReturn);
    const db: any = {
      client: {
        rpc: rpcMock,
        from: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        CouponsService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();
    return { service: module.get<CouponsService>(CouponsService), rpcMock };
  }

  it('calls redeem_coupon RPC with correct args for registered user', async () => {
    const { service, rpcMock } = await makeServiceWithRpc({ data: true, error: null });
    await service.redeem('coupon-1', 'order-1', 'user-abc', undefined);
    expect(rpcMock).toHaveBeenCalledWith('redeem_coupon', {
      p_coupon_id: 'coupon-1',
      p_order_id: 'order-1',
      p_user_id: 'user-abc',
      p_guest_email: null,
    });
  });

  it('calls redeem_coupon RPC with guest_email lowercased', async () => {
    const { service, rpcMock } = await makeServiceWithRpc({ data: true, error: null });
    await service.redeem('coupon-2', 'order-2', undefined, 'Guest@Test.COM');
    expect(rpcMock).toHaveBeenCalledWith('redeem_coupon', expect.objectContaining({
      p_guest_email: 'guest@test.com',
      p_user_id: null,
    }));
  });

  it('does NOT throw when RPC returns false (concurrent race — order already placed, log only)', async () => {
    // Concurrent winner claimed the last use; we log a warning but do NOT
    // throw — rolling back the already-placed order is worse than the discrepancy.
    const { service } = await makeServiceWithRpc({ data: false, error: null });
    await expect(service.redeem('coupon-3', 'order-3', 'user-x')).resolves.not.toThrow();
  });
});
