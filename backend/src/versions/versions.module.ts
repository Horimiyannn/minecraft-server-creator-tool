import { Module } from '@nestjs/common';
import { VersionsController } from './versions.controller';
import { VersionsService, HTTP_FETCHER } from './versions.service';
import { FetchHttpFetcher } from './http-fetcher';

@Module({
  controllers: [VersionsController],
  providers: [
    VersionsService,
    { provide: HTTP_FETCHER, useClass: FetchHttpFetcher },
  ],
})
export class VersionsModule {}
