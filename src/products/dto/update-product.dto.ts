import { IsString, IsOptional, IsBoolean, IsNumber, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductFaqDto } from './create-product.dto';

export class UpdateProductDto {
  @IsOptional() @IsString()  name?: string;
  @IsOptional() @IsString()  slug?: string;
  @IsOptional() @IsString()  sku?: string;
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
  /** YouTube embed URL or video ID shown below the product description. */
  @IsOptional() @IsString()  youtube_url?: string;
  /** Multiple product videos (YouTube links and/or uploaded mp4 URLs). */
  @IsOptional() @IsArray() @IsString({ each: true })  videos?: string[];
  @IsOptional() @IsNumber()  sort_weight?: number;
  /** Fabric composition and care instructions. */
  @IsOptional() @IsString()  fabric_care?: string;
  /** Model info shown on product page, e.g. "Model is 5'6", 58 kg, wearing size S" */
  @IsOptional() @IsString()  model_info?: string;
  /** Admin-editable FAQ list shown on the product page: [{ q, a }, ...]. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProductFaqDto)  faqs?: ProductFaqDto[];
}
