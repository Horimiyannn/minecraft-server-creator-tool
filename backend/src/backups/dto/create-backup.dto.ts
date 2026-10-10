import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBackupDto {
  @IsIn(['world', 'full'])
  kind!: 'world' | 'full';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}
