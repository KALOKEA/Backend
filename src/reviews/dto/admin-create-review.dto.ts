import { IsUUID, IsInt, IsString, IsOptional, Min, Max, IsISO8601, MaxLength } from 'class-validator';

/** Admin-created review (seeded / imported). No purchase verification. */
export class AdminCreateReviewDto {
  @IsUUID()
  product_id: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @MaxLength(80)
  guest_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  /** Optional backdated timestamp (ISO 8601) so seeded reviews aren't all "today". */
  @IsOptional()
  @IsISO8601()
  created_at?: string;
}
