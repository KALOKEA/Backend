import { IsString, IsOptional, IsObject, IsUUID } from 'class-validator';

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
}
