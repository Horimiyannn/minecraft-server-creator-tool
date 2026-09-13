import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class CompressDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  paths!: string[];

  @IsString()
  @MaxLength(1024)
  dest!: string;
}
