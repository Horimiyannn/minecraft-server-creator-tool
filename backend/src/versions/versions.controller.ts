import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Loader } from '../servers/provisioning';
import { VersionsService, VersionList, BuildList } from './versions.service';

@UseGuards(JwtAuthGuard)
@Controller('versions')
export class VersionsController {
  constructor(private readonly versionsService: VersionsService) {}

  @Get(':loader')
  list(@Param('loader') loader: string): Promise<VersionList> {
    return this.versionsService.list(loader as Loader);
  }

  @Get(':loader/builds/:mcVersion')
  listBuilds(
    @Param('loader') loader: string,
    @Param('mcVersion') mcVersion: string,
  ): Promise<BuildList> {
    return this.versionsService.listBuilds(loader as Loader, mcVersion);
  }
}
