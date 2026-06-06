import { IsString, IsOptional, IsBoolean, IsNumber, IsArray, IsUUID } from 'class-validator';

export class UpdateProductDto {
  @IsOptional() @IsString()  name?: string;
  @IsOptional() @IsString()  slug?: string;
  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsUUID()    category_id?: string;
  @IsOptional() @IsNumber()  base_price?: number;
  @IsOptional() @IsNumber()  compare_price?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsBoolean() is_featured?: boolean;
  @IsOptional() @IsArray()   tags?: string[];
  @IsOptional() @IsString()  meta_title?: string;
  @IsOptional() @IsString()  meta_description?: string;
  @IsOptional() @IsString()  hsn_code?: string;
  @IsOptional() @IsNumber()  gst_rate?: number;
  @IsOptional() @IsString()  video_url?: string;
}
