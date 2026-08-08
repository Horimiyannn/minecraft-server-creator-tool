import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ContainerStatus } from './docker.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServersService, PublicServer } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';

@UseGuards(JwtAuthGuard)
@Controller('servers')
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

  @Post()
  create(@Body() dto: CreateServerDto): Promise<PublicServer> {
    return this.serversService.createServer(dto);
  }

  @Get()
  list(): Promise<PublicServer[]> {
    return this.serversService.listServers();
  }

  @Get(':id')
  get(
    @Param('id') id: string,
  ): Promise<PublicServer & { live: ContainerStatus | null }> {
    return this.serversService.getServer(id);
  }

  @Post(':id/start')
  start(@Param('id') id: string): Promise<PublicServer> {
    return this.serversService.start(id);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string): Promise<PublicServer> {
    return this.serversService.stop(id);
  }

  @Post(':id/restart')
  restart(@Param('id') id: string): Promise<PublicServer> {
    return this.serversService.restart(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.serversService.deleteServer(id);
    return { ok: true };
  }
}
