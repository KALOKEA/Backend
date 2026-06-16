import { IsString, IsOptional, IsArray, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Minimal address DTO for the quote endpoint.
 * Only the buyer's state is needed to determine the CGST/SGST vs IGST split.
 * Full address validation is NOT needed here (that happens on createOrder).
 */
export class QuoteAddressDto {
  @IsOptional()
  @IsString()
  state?: string;
}

/**
 * Request body for POST /orders/quote.
 * Looser than CreateOrderDto: no address fields are required because
 * the quote is informational only (not persisted) and only needs the
 * buyer state for tax calculations.
 */
export class QuoteOrderDto {
  @IsOptional()
  @IsString()
  session_id?: string;

  @IsOptional()
  @IsString()
  address_id?: string;

  /** Only state is used for GST split; other address fields are ignored. */
  @IsOptional()
  @Type(() => QuoteAddressDto)
  address_snapshot?: QuoteAddressDto;

  @IsOptional()
  @IsString()
  @IsIn(['razorpay', 'cod', 'upi', 'card', 'netbanking', 'wallet', ''])
  payment_method?: string;

  @IsOptional()
  @IsString()
  coupon_code?: string;

  @IsOptional()
  @IsArray()
  cart_items?: { variant_id: string; quantity: number }[];
}
