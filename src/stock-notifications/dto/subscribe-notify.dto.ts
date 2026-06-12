import { IsEmail, IsUUID } from 'class-validator';

export class SubscribeNotifyDto {
  @IsUUID()
  variant_id: string;

  @IsEmail()
  email: string;
}
