import { IsString, IsOptional, IsObject, IsUUID, IsBoolean, IsArray, ValidateNested, IsNumber, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class ClientCartItemDto {
  @IsUUID()
  variant_id: string;

  @IsNumber()
  @IsPositive()
  quantity: number;
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
  @IsObject()
  address_snapshot?: {
    name: string;
    phone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };

  @IsString()
  payment_method: string; // 'upi' | 'card' | 'netbanking' | 'wallet' | 'cod' — normalized server-side

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
  gstin?: string;

  // Fallback cart items from the frontend (used when server cart is missing,
  // e.g. items added while offline or when the sync failed). Prices are always
  // loaded server-side from the variant — the client only sends variant_id+qty.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClientCartItemDto)
  client_items?: ClientCartItemDto[];
}
