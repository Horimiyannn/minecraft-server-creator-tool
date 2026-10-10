import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { BackupsModule } from '../backups/backups.module';
import { MetricsGateway } from './metrics.gateway';
import { MetricsService } from './metrics.service';

@Module({
  imports: [AuthModule, ServersModule, BackupsModule],
  providers: [MetricsGateway, MetricsService],
})
export class MetricsModule {}
