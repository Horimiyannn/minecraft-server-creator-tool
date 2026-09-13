import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { AuthModule } from '../auth/auth.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { ServerFsService } from './server-fs.service';
import { ArchiveService } from './archive.service';

@Module({
  imports: [ServersModule, AuthModule],
  controllers: [FilesController],
  providers: [FilesService, ServerFsService, ArchiveService],
  exports: [ServerFsService, ArchiveService],
})
export class FilesModule {}
