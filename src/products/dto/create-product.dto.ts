import { IsString, IsOptional, IsBoolean, IsNumber, IsArray, IsUUID } from 'class-validator';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsNumber()
  base_price: number;

  @IsOptional()
  @IsNumber()
  compare_price?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  is_featured?: boolean;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsString()
  meta_title?: string;

  @IsOptional()
  @IsString()
  meta_description?: string;

  // GST: HSN code + per-product rate (e.g. 5 / 12 / 18). Leave rate empty to use
  // the store-wide default from Settings.
  @IsOptional()
  @IsString()
  hsn_code?: string;

  @IsOptional()
  @IsNumber()
  gst_rate?: number;

  @IsOptional()
  @IsString()
  video_url?: string;

  /** YouTube embed URL or video ID shown below the product description. */
  @IsOptional()
  @IsString()
  youtube_url?: string;

  @IsOptional()
  @IsNumber()
  sort_weight?: number;

  /** Fabric composition and care instructions (displayed on product page). */
  @IsOptional()
  @IsString()
  fabric_care?: string;

  /** Model info shown on product page, e.g. "Model is 5'6", 58 kg, wearing size S" */
  @IsOptional()
  @IsString()
  model_info?: string;

  /** Admin-editable FAQ list shown on the product page: [{ q, a }, ...]. */
  @IsOptional()
  @IsArray()
  faqs?: { q: string; a: string }[];
}
