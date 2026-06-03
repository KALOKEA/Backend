import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class AddImageDto {
  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  public_id?: string;

  @IsOptional()
  @IsString()
  alt_text?: string;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @IsOptional()
  @IsNumber()
  sort_order?: number;
}
