import { IsEmail, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ContactDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  message: string;
}
