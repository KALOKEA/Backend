import { IsString, IsNumber, IsOptional, IsBoolean, IsUUID, Min } from 'class-validator';

export class CreateVariantDto {
  @IsUUID()
  product_id: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsString()
  colour?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(0)
  stock: number;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
