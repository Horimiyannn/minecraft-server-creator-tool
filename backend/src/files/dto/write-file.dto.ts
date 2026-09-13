import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class WriteFileDto {
  @IsString()
  @MaxLength(1024)
  path!: string;

  @IsString()
  content!: string;

  /**
   * mtime the editor loaded; omit to force-overwrite. fs.stat reports it with
   * sub-millisecond precision, so it is a float — never require an integer.
   */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  mtimeMs?: number;
}
