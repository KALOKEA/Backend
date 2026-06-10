import { IsOptional, IsString, IsNumber, Min, Max, IsEmail } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsString() seller_name?: string;
  @IsOptional() @IsString() seller_address?: string;
  @IsOptional() @IsString() seller_gstin?: string;
  @IsOptional() @IsString() seller_state?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(28) gst_rate?: number;
  @IsOptional() @IsEmail() admin_email?: string;

  /** Shipping fee in paise (e.g. 4900 = ₹49). Set 0 for always-free. */
  @IsOptional() @IsNumber() @Min(0) shipping_fee?: number;

  /** Free-shipping threshold in paise (e.g. 99900 = ₹999). */
  @IsOptional() @IsNumber() @Min(0) shipping_free_threshold?: number;

  /** COD surcharge in paise. Set 0 to disable. */
  @IsOptional() @IsNumber() @Min(0) cod_fee?: number;

  /** Live chat widget embed script (Tawk.to / Crisp / WhatsApp). */
  @IsOptional() @IsString() live_chat_widget?: string;

  /** Low stock alert threshold — notify admin when product stock drops below this. */
  @IsOptional() @IsNumber() @Min(1) @Max(100) low_stock_threshold?: number;

  /** Footer social / brand links — editable from admin without a code deploy. */
  @IsOptional() @IsString() footer_instagram_url?: string;
  @IsOptional() @IsString() footer_whatsapp_url?: string;
  @IsOptional() @IsString() footer_facebook_url?: string;
  @IsOptional() @IsString() footer_pinterest_url?: string;
}
