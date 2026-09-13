import { IsString, MaxLength } from 'class-validator';

export class ExtractDto {
  @IsString()
  @MaxLength(1024)
  path!: string;

  @IsString()
  @MaxLength(1024)
  dest!: string;
}
