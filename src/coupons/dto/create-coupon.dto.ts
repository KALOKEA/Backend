import { IsString, IsNumber, IsOptional, IsBoolean, IsIn, Min } from 'class-validator';

export class CreateCouponDto {
  @IsString()
  code: string;

  @IsString()
  @IsIn(['percent', 'fixed'])
  type: string;

  @IsNumber()
  @Min(0)
  value: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  min_order_value?: number;

  @IsOptional()
  @IsNumber()
  max_uses?: number;

  /** Maximum redemptions per individual user. NULL = no per-user limit. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  max_per_user?: number;

  /** Optional start date — coupon cannot be used before this date. */
  @IsOptional()
  valid_from?: string;

  @IsOptional()
  valid_until?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  /** When true, advertised on product pages as a "Get it at ₹X" offer. */
  @IsOptional()
  @IsBoolean()
  is_featured?: boolean;

  /**
   * When true, the coupon cannot be disabled via the toggle endpoint.
   * Designed for platform-level offers like WELCOME15 that must always be available.
   */
  @IsOptional()
  @IsBoolean()
  is_permanent?: boolean;

  /**
   * When true, the coupon is only valid for customers who have never placed
   * a confirmed order before. Enforced both server-side at validate() and
   * again at order creation.
   */
  @IsOptional()
  @IsBoolean()
  new_users_only?: boolean;
}
