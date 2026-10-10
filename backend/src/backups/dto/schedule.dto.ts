import {
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_KEEP, MIN_INTERVAL_MIN } from '../backup-schedule.service';

export class ScheduleDto {
  @ValidateIf((_o, value) => value !== null)
  @IsOptional()
  @IsInt()
  @Min(MIN_INTERVAL_MIN)
  @Max(60 * 24 * 7)
  worldEveryMin!: number | null;

  @ValidateIf((_o, value) => value !== null)
  @IsOptional()
  @IsInt()
  @Min(MIN_INTERVAL_MIN)
  @Max(60 * 24 * 7)
  fullEveryMin!: number | null;

  @IsInt()
  @Min(1)
  @Max(MAX_KEEP)
  keepWorld!: number;

  @IsInt()
  @Min(1)
  @Max(MAX_KEEP)
  keepFull!: number;

  @IsBoolean()
  skipWhenEmpty!: boolean;

  @IsBoolean()
  chatEnabled!: boolean;
}
