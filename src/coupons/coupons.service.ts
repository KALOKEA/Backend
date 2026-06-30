import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);
  constructor(private db: DatabaseService) {}

  async validate(dto: ValidateCouponDto) {
    const { data: coupon } = await this.db.client
      .from('coupons')
      .select('*')
      .eq('code', dto.code.toUpperCase())
      .eq('is_active', true)
      .single();

    if (!coupon) throw new NotFoundException('Coupon not found or inactive');

    // Date range checks
    if (coupon.valid_from && new Date(coupon.valid_from) > new Date())
      throw new BadRequestException('This coupon is not active yet');
    if (coupon.valid_until && new Date(coupon.valid_until) < new Date())
      throw new BadRequestException('Coupon expired');

    // Global usage cap
    if (coupon.max_uses && coupon.used_count >= coupon.max_uses)
      throw new BadRequestException('Coupon usage limit reached');

    // Per-user cap check: enforce max_per_user for both logged-in users and guests.
    // Guests are identified by guest_email so "first order only" coupons can't
    // be replayed by repeatedly checking out without an account.
    if (coupon.max_per_user) {
      if (dto.user_id) {
        const { count } = await this.db.client
          .from('coupon_uses')
          .select('id', { count: 'exact', head: true })
          .eq('coupon_id', coupon.id)
          .eq('user_id', dto.user_id);
        if ((count ?? 0) >= coupon.max_per_user) {
          throw new BadRequestException(
            `This coupon can only be used ${coupon.max_per_user} time${coupon.max_per_user === 1 ? '' : 's'} per customer`,
          );
        }
      } else if (dto.guest_email) {
        const { count } = await this.db.client
          .from('coupon_uses')
          .select('id', { count: 'exact', head: true })
          .eq('coupon_id', coupon.id)
          .eq('guest_email', dto.guest_email.toLowerCase());
        if ((count ?? 0) >= coupon.max_per_user) {
          throw new BadRequestException(
            `This coupon can only be used ${coupon.max_per_user} time${coupon.max_per_user === 1 ? '' : 's'} per customer`,
          );
        }
      }
    }

    // New-users-only check: reject if the customer already has a confirmed order.
    if (coupon.new_users_only) {
      const confirmedStatuses = ['confirmed', 'processing', 'shipped', 'delivered'];
      if (dto.user_id) {
        const { count } = await this.db.client
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', dto.user_id)
          .in('status', confirmedStatuses);
        if ((count ?? 0) > 0) {
          throw new BadRequestException('This coupon is only valid on your first order');
        }
      } else if (dto.guest_email) {
        const { count } = await this.db.client
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('guest_email', dto.guest_email.toLowerCase())
          .in('status', confirmedStatuses);
        if ((count ?? 0) > 0) {
          throw new BadRequestException('This coupon is only valid on your first order');
        }
      }
      // If neither user_id nor guest_email provided, allow — cannot verify at this stage.
      // Order creation re-validates with full context and will catch it.
    }

    if (dto.order_value < coupon.min_order_value)
      throw new BadRequestException(`Minimum order value ₹${Math.round(coupon.min_order_value / 100)} required`);

    const rawDiscount = coupon.type === 'percent'
      ? Math.round((dto.order_value * coupon.value) / 100)
      : coupon.value;
    // Never discount more than the order is worth.
    const discount = Math.min(rawDiscount, dto.order_value);

    return {
      valid: true,
      coupon_id: coupon.id,
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discount,
      discount_amount: discount, // alias expected by the storefront
    };
  }

  /**
   * Public: best FEATURED coupon applicable to a single item at `price` (paise).
   * Powers the "Get it at ₹X — How?" badge. Only is_featured coupons are returned,
   * so secret / targeted codes are never exposed on public product pages.
   */
  async bestOffer(price: number) {
    if (!price || price <= 0) return { best: null };
    const now = new Date();
    const { data: coupons } = await this.db.client
      .from('coupons')
      .select('code, type, value, min_order_value, max_uses, used_count, valid_from, valid_until')
      .eq('is_active', true)
      .eq('is_featured', true);

    let best: { code: string; type: string; value: number; discount: number; final_price: number } | null = null;
    for (const c of coupons || []) {
      if (c.valid_until && new Date(c.valid_until) < now) continue;
      if (c.valid_from && new Date(c.valid_from) > now) continue;
      if (c.max_uses != null && c.used_count >= c.max_uses) continue;
      if ((c.min_order_value || 0) > price) continue;
      const raw = c.type === 'percent' ? Math.round((price * c.value) / 100) : c.value;
      const discount = Math.min(raw, price);
      if (discount > 0 && (!best || discount > best.discount)) {
        best = { code: c.code, type: c.type, value: c.value, discount, final_price: price - discount };
      }
    }
    return { best };
  }

  // Record a redemption once an order using this coupon is placed. Atomic:
  // redeem_coupon bumps used_count only if still under max_uses and records the
  // use in one statement, so two concurrent orders can't exceed the limit.
  async redeem(couponId: string, orderId: string, userId?: string, guestEmail?: string) {
    const { data: ok, error } = await this.db.client.rpc('redeem_coupon', {
      p_coupon_id: couponId,
      p_order_id: orderId,
      p_user_id: userId || null,
      p_guest_email: guestEmail ? guestEmail.toLowerCase() : null,
    });
    if (error || ok !== true) {
      this.logger.warn(`Coupon ${couponId} redemption not recorded for order ${orderId} (limit reached or error)`);
    }
  }

  async findAll() {
    const { data } = await this.db.client
      .from('coupons').select('*').order('created_at', { ascending: false });
    return data || [];
  }

  async create(dto: CreateCouponDto) {
    const { data, error } = await this.db.client
      .from('coupons')
      .insert({ ...dto, code: dto.code.toUpperCase() })
      .select().single();
    if (error) throw error;
    return data;
  }

  async toggle(id: string) {
    const { data: coupon } = await this.db.client
      .from('coupons')
      .select('is_active, is_permanent')
      .eq('id', id)
      .single();
    if (!coupon) throw new NotFoundException('Coupon not found');

    // Permanent coupons cannot be disabled — they are platform-level offers
    // (e.g. WELCOME15) that must always be available to new customers.
    if (coupon.is_permanent && coupon.is_active) {
      throw new BadRequestException('Permanent coupons cannot be disabled');
    }

    const { data } = await this.db.client
      .from('coupons').update({ is_active: !coupon.is_active }).eq('id', id).select().single();
    return data;
  }

  async update(id: string, dto: Partial<CreateCouponDto>) {
    // Fetch existing coupon to enforce permanent-coupon invariants.
    const { data: existing } = await this.db.client
      .from('coupons')
      .select('is_permanent')
      .eq('id', id)
      .single();
    if (!existing) throw new NotFoundException('Coupon not found');

    const safeDto: Record<string, unknown> = {
      ...dto,
      ...(dto.code ? { code: dto.code.toUpperCase() } : {}),
    };

    if (existing.is_permanent) {
      // Permanent coupons: cannot be deactivated or un-permanented via update.
      delete safeDto['is_permanent'];
      if (safeDto['is_active'] === false) {
        delete safeDto['is_active']; // silently preserve is_active = true
      }
    } else if (safeDto['is_permanent'] === false) {
      // Non-permanent coupons: is_permanent is one-way (can be SET to true, never revoked).
      delete safeDto['is_permanent'];
    }

    const { data, error } = await this.db.client
      .from('coupons')
      .update(safeDto)
      .eq('id', id)
      .select().single();
    if (error || !data) throw new NotFoundException('Coupon not found');
    return data;
  }
}
