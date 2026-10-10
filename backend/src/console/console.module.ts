import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { ConsoleGateway } from './console.gateway';
import { RconService } from './rcon.service';
import { LogStreamService } from './log-stream.service';

@Module({
  imports: [AuthModule, ServersModule],
  providers: [ConsoleGateway, RconService, LogStreamService],
  exports: [RconService, LogStreamService],
})
export class ConsoleModule {}
