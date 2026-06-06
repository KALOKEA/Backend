import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

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
}
