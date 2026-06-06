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

  @IsOptional()
  valid_until?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
