import { IsString, MaxLength } from 'class-validator';

export class RenameDto {
  @IsString()
  @MaxLength(1024)
  from!: string;

  @IsString()
  @MaxLength(1024)
  to!: string;
}
