import { IsString, IsOptional, IsEmail, Matches } from 'class-validator';

export class SendOtpDto {
  @IsOptional()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Invalid phone number' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
