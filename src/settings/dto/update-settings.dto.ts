import { IsOptional, IsString, IsNumber, Min, Max, IsEmail } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  seller_name?: string;

  @IsOptional()
  @IsString()
  seller_address?: string;

  @IsOptional()
  @IsString()
  seller_gstin?: string;

  @IsOptional()
  @IsString()
  seller_state?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(28)
  gst_rate?: number;

  @IsOptional()
  @IsEmail()
  admin_email?: string;
}
