import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class WriteFileDto {
  @IsString()
  @MaxLength(1024)
  path!: string;

  @IsString()
  content!: string;

  /** mtime the editor loaded; omit to force-overwrite. */
  @IsOptional()
  @IsInt()
  mtimeMs?: number;
}
