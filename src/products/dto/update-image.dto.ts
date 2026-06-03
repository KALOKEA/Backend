import { IsOptional, IsString, IsNumber } from 'class-validator';

export class UpdateImageDto {
  @IsOptional()
  @IsString()
  alt_text?: string;

  @IsOptional()
  @IsNumber()
  sort_order?: number;
}
