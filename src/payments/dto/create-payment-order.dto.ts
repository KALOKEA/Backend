import { IsUUID } from 'class-validator';

export class CreatePaymentOrderDto {
  @IsUUID()
  order_id: string;
}
