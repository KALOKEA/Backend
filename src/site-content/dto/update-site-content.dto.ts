import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateSiteContentDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  value: string;
}
