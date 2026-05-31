import { IsString, IsOptional, IsBoolean, IsNumber, IsIn } from 'class-validator';

export class CreateBannerDto {
  @IsString()
  title: string;

  @IsString()
  image_url: string;

  @IsOptional()
  @IsString()
  link_url?: string;

  @IsString()
  @IsIn(['hero', 'mid', 'footer'])
  position: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsNumber()
  sort_order?: number;
}
