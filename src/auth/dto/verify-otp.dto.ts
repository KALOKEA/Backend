import { IsString, IsOptional, Length } from 'class-validator';

export class VerifyOtpDto {
  @IsOptional()
  phone?: string;

  @IsOptional()
  email?: string;

  @IsString()
  @Length(6, 6, { message: 'OTP must be 6 digits' })
  otp: string;
}
