import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { ServerRepository } from './server.repository';
import { DockerService } from './docker.service';

@Module({
  imports: [PrismaModule],
  controllers: [ServersController],
  providers: [ServersService, ServerRepository, DockerService],
  exports: [ServersService, DockerService],
})
export class ServersModule {}
