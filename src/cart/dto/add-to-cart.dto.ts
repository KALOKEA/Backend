import { IsUUID, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AddToCartDto {
  @IsUUID()
  variant_id: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  session_id?: string; // guest cart session
}
