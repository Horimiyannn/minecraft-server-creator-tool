import { IsString, MaxLength } from 'class-validator';

export class FilePathDto {
  @IsString()
  @MaxLength(1024)
  path!: string;
}
