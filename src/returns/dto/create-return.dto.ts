import { IsUUID, IsString, IsOptional, IsIn } from 'class-validator';

export class CreateReturnDto {
  @IsUUID()
  order_id: string;

  @IsOptional()
  @IsUUID()
  order_item_id?: string;

  @IsString()
  @IsIn(['Wrong size', 'Damaged', 'Wrong item', 'Quality issue', 'Changed mind', 'Other'])
  reason: string;
}
