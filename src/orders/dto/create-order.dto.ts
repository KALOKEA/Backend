import {
  IsString, IsOptional, IsUUID, IsBoolean, IsArray,
  IsIn, IsNotEmpty, Matches, Length, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Validates the nested delivery address fields properly (NH-3). */
export class AddressSnapshotDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsString() @IsNotEmpty()
  @Matches(/^\d{10}$/, { message: 'phone must be a 10-digit number' })
  phone: string;

  @IsString() @IsNotEmpty()
  line1: string;

  @IsOptional() @IsString()
  line2?: string;

  @IsString() @IsNotEmpty()
  city: string;

  @IsString() @IsNotEmpty()
  state: string;

  @IsString() @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'pincode must be a 6-digit number' })
  @Length(6, 6)
  pincode: string;
}

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  session_id?: string; // guest cart

  // Logged-in users send a saved address_id; the backend loads it and snapshots
  // it (with an ownership check). Guests send address_snapshot directly.
  @IsOptional()
  @IsUUID()
  address_id?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressSnapshotDto)
  address_snapshot?: AddressSnapshotDto;

  // Accept all known frontend payment identifiers; service normalises to 'cod' | 'razorpay'.
  @IsString()
  @IsIn(['razorpay', 'cod', 'upi', 'card', 'netbanking', 'wallet'], {
    message: "payment_method must be one of: razorpay, cod, upi, card, netbanking, wallet",
  })
  payment_method: string;

  @IsOptional()
  @IsString()
  coupon_code?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  guest_phone?: string;

  @IsOptional()
  @IsString()
  guest_email?: string;

  // B2B GST invoice (optional): buyer wants their company GSTIN on the invoice.
  @IsOptional()
  @IsBoolean()
  gst_invoice?: boolean;

  @IsOptional()
  @IsString()
  company_name?: string;

  @IsOptional()
  @IsString()
  @Matches(
    /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/,
    { message: 'gstin must be a valid 15-character Indian GSTIN (e.g. 29ABCDE1234F1Z5)' },
  )
  gstin?: string;

  // Fallback cart items from the frontend (used when server cart is missing).
  // Prices are re-validated server-side — never trust client-submitted prices.
  // This field is optional fallback when server cart is unavailable.
  @IsOptional()
  @IsArray()
  cart_items?: any[];
}
