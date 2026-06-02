import { IsUUID, IsString, IsIn } from 'class-validator';

export class CreateExchangeDto {
  @IsUUID()
  order_id: string;

  // The ordered line being exchanged.
  @IsUUID()
  order_item_id: string;

  // The variant the customer wants instead (e.g. a different size/colour).
  @IsUUID()
  new_variant_id: string;

  @IsString()
  @IsIn(['Wrong size', 'Wrong colour', 'Damaged', 'Wrong item', 'Quality issue', 'Other'])
  reason: string;
}
