import { IsString, IsOptional, IsObject, IsArray, IsNumber, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  session_id?: string; // guest cart

  @IsObject()
  address_snapshot: {
    name: string;
    phone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };

  @IsString()
  payment_method: string; // 'razorpay' | 'cod'

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
