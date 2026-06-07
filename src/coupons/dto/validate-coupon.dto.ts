import { IsString, IsNumber, IsOptional, IsEmail, Min } from 'class-validator';

export class ValidateCouponDto {
  @IsString()
  code: string;

  @IsNumber()
  @Min(0)
  order_value: number;

  /** Authenticated user ID — used to enforce max_per_user cap. */
  @IsOptional()
  @IsString()
  user_id?: string;

  /**
   * Guest email — used as identity for per-user cap enforcement when user_id
   * is absent (guest checkout). Prevents a guest from using a single-use or
   * per-user-capped coupon multiple times by rotating email addresses.
   */
  @IsOptional()
  @IsEmail()
  guest_email?: string;
}
