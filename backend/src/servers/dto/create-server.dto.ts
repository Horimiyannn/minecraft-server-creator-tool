import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { LOADERS, Loader } from '../provisioning';

export class CreateServerDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,31}$/i, {
    message: 'name must be 1-32 chars: letters, digits, hyphens',
  })
  name!: string;

  @IsIn(LOADERS)
  loader!: Loader;

  @IsString()
  @Matches(/^[0-9][0-9A-Za-z._-]{0,31}$/, {
    message: 'version has an invalid format',
  })
  version!: string;

  /** Exact loader build; omit to let itzg resolve the latest for the version. */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9][0-9A-Za-z._-]{0,39}$/, {
    message: 'loaderVersion has an invalid format',
  })
  loaderVersion?: string;

  @IsInt()
  @Min(512)
  @Max(32768)
  ramMb!: number;

  @IsInt()
  @Min(1024)
  @Max(65535)
  port!: number;
}
