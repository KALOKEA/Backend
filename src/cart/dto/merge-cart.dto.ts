import { IsString } from 'class-validator';

export class MergeCartDto {
  @IsString()
  session_id: string;
}
