import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

@Injectable()
export class CouponsService {
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
    if (dto.order_value < coupon.min_order_value)
      throw new BadRequestException(`Minimum order value ₹${coupon.min_order_value} required`);

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

  // Record a redemption once an order using this coupon is placed.
  async redeem(couponId: string, orderId: string, userId?: string) {
    const { data: coupon } = await this.db.client
      .from('coupons').select('used_count').eq('id', couponId).single();
    await this.db.client
      .from('coupons')
      .update({ used_count: (coupon?.used_count || 0) + 1 })
      .eq('id', couponId);
    await this.db.client
      .from('coupon_uses')
      .insert({ coupon_id: couponId, order_id: orderId, user_id: userId || null });
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
}
