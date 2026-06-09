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
    if (coupon.valid_until && new Date(coupon.valid_until) < new Date())
      throw new BadRequestException('Coupon expired');
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
        // Guest path: check usage by email. Not bullet-proof (guests can change
        // email) but it closes the trivial bot exploit for per-user-capped promos.
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
    // The order is already placed; if the limit was hit in a race we can't undo
    // the discount, but we log it so it can be reconciled. used_count stays correct.
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
    const { data: coupon } = await this.db.client.from('coupons').select('is_active').eq('id', id).single();
    if (!coupon) throw new NotFoundException('Coupon not found');
    const { data } = await this.db.client
      .from('coupons').update({ is_active: !coupon.is_active }).eq('id', id).select().single();
    return data;
  }

  async update(id: string, dto: Partial<CreateCouponDto>) {
    const { data, error } = await this.db.client
      .from('coupons')
      .update({ ...dto, ...(dto.code ? { code: dto.code.toUpperCase() } : {}) })
      .eq('id', id)
      .select().single();
    if (error || !data) throw new NotFoundException('Coupon not found');
    return data;
  }
}
