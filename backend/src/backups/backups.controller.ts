import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BackupService } from './backup.service';
import { BackupScheduleService } from './backup-schedule.service';
import { BackupRecord, ScheduleRecord } from './backup.repository';
import { CreateBackupDto } from './dto/create-backup.dto';
import { ScheduleDto } from './dto/schedule.dto';

/** JSON has no BigInt, so sizes cross the wire as numbers. */
export interface PublicBackup extends Omit<BackupRecord, 'sizeBytes' | 'path'> {
  sizeBytes: number;
}

function toPublic(record: BackupRecord): PublicBackup {
  const { sizeBytes, path: _omit, ...rest } = record;
  return { ...rest, sizeBytes: Number(sizeBytes) };
}

@UseGuards(JwtAuthGuard)
@Controller('servers/:id/backups')
export class BackupsController {
  constructor(
    private readonly backupService: BackupService,
    private readonly backupScheduleService: BackupScheduleService,
  ) {}

  @Get()
  async list(@Param('id') id: string): Promise<PublicBackup[]> {
    return (await this.backupService.list(id)).map(toPublic);
  }

  @Post()
  async create(
    @Param('id') id: string,
    @Body() dto: CreateBackupDto,
  ): Promise<PublicBackup> {
    return toPublic(
      await this.backupService.create(id, dto.kind, 'manual', dto.label),
    );
  }

  @Get('schedule')
  schedule(@Param('id') id: string): Promise<ScheduleRecord> {
    return this.backupScheduleService.get(id);
  }

  @Put('schedule')
  saveSchedule(
    @Param('id') id: string,
    @Body() dto: ScheduleDto,
  ): Promise<ScheduleRecord> {
    return this.backupScheduleService.save(id, dto);
  }

  @Post(':backupId/restore')
  async restore(
    @Param('id') id: string,
    @Param('backupId') backupId: string,
  ): Promise<{ ok: true }> {
    await this.backupService.restore(id, backupId);
    return { ok: true };
  }

  @Get(':backupId/download')
  async download(
    @Param('id') id: string,
    @Param('backupId') backupId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { path, filename } = await this.backupService.pathFor(id, backupId);
    res.set({
      'Content-Type': 'application/zstd',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(createReadStream(path));
  }

  @Delete(':backupId')
  async remove(
    @Param('id') id: string,
    @Param('backupId') backupId: string,
  ): Promise<{ ok: true }> {
    await this.backupService.remove(id, backupId);
    return { ok: true };
  }
}
