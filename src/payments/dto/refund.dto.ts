import { IsUUID, IsOptional, IsNumber, IsString, Min } from 'class-validator';

export class RefundDto {
  @IsUUID()
  order_id: string;

  // Optional explicit amount in paise. If omitted, defaults to the returned
  // item's value (when return_id given) or the full order total.
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsUUID()
  return_id?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
