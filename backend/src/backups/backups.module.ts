import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServersModule } from '../servers/servers.module';
import { ConsoleModule } from '../console/console.module';
import { AuthModule } from '../auth/auth.module';
import { BackupsController } from './backups.controller';
import { BackupService } from './backup.service';
import { BackupRepository } from './backup.repository';
import { BackupScheduleService } from './backup-schedule.service';
import { ChatTriggerService } from './chat-trigger.service';
import { TarService } from './tar.service';

@Module({
  imports: [PrismaModule, ServersModule, ConsoleModule, AuthModule],
  controllers: [BackupsController],
  providers: [
    BackupService,
    BackupRepository,
    BackupScheduleService,
    ChatTriggerService,
    TarService,
  ],
  exports: [BackupService, BackupRepository],
})
export class BackupsModule {}
