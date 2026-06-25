import { IsString, IsOptional, IsArray, IsIn, MaxLength } from 'class-validator';

export class CreateBlogPostDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  heading?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  heading_italic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  eyebrow?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  description?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  cover_image?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  reading_time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  author?: string;

  @IsOptional()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';
}
