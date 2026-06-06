import { IsUUID, IsInt, IsString, IsOptional, IsArray, IsUrl, Min, Max } from 'class-validator';

export class CreateReviewDto {
  @IsUUID()
  product_id: string;

  @IsOptional()
  @IsUUID()
  order_id?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  /** Cloudinary URLs of attached photos / short videos (max 5). */
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  media_urls?: string[];
}
