import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type BackupKind = 'world' | 'full';
export type BackupTrigger = 'manual' | 'chat' | 'schedule';

export interface BackupRecord {
  id: string;
  serverId: string;
  kind: BackupKind;
  trigger: BackupTrigger;
  label: string | null;
  path: string;
  sizeBytes: bigint;
  createdAt: Date;
}

export interface CreateBackupData {
  serverId: string;
  kind: BackupKind;
  trigger: BackupTrigger;
  label?: string | null;
  path: string;
  sizeBytes: bigint;
}

export interface ScheduleRecord {
  serverId: string;
  worldEveryMin: number | null;
  fullEveryMin: number | null;
  keepWorld: number;
  keepFull: number;
  skipWhenEmpty: boolean;
  chatEnabled: boolean;
}

export type ScheduleUpdate = Omit<ScheduleRecord, 'serverId'>;

/** Applied when a server has never had a schedule saved. */
const SCHEDULE_DEFAULTS: ScheduleUpdate = {
  worldEveryMin: null,
  fullEveryMin: null,
  keepWorld: 12,
  keepFull: 5,
  skipWhenEmpty: true,
  chatEnabled: true,
};

@Injectable()
export class BackupRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async create(data: CreateBackupData): Promise<BackupRecord> {
    return (await this.prismaService.backup.create({
      data,
    })) as BackupRecord;
  }

  async listByServer(serverId: string): Promise<BackupRecord[]> {
    return (await this.prismaService.backup.findMany({
      where: { serverId },
      orderBy: { createdAt: 'desc' },
    })) as BackupRecord[];
  }

  async listByKindOldestFirst(
    serverId: string,
    kind: BackupKind,
  ): Promise<BackupRecord[]> {
    return (await this.prismaService.backup.findMany({
      where: { serverId, kind },
      orderBy: { createdAt: 'asc' },
    })) as BackupRecord[];
  }

  async findById(id: string): Promise<BackupRecord | null> {
    return (await this.prismaService.backup.findUnique({
      where: { id },
    })) as BackupRecord | null;
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prismaService.backup.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Backup "${id}" not found`);
      }
      throw error;
    }
  }

  async totalBytes(serverId: string): Promise<bigint> {
    const result = await this.prismaService.backup.aggregate({
      where: { serverId },
      _sum: { sizeBytes: true },
    });
    return result._sum.sizeBytes ?? 0n;
  }

  async getSchedule(serverId: string): Promise<ScheduleRecord> {
    const row = await this.prismaService.backupSchedule.findUnique({
      where: { serverId },
    });
    return row ?? { serverId, ...SCHEDULE_DEFAULTS };
  }

  async listSchedules(): Promise<ScheduleRecord[]> {
    return (await this.prismaService.backupSchedule.findMany()) as ScheduleRecord[];
  }

  async upsertSchedule(
    serverId: string,
    data: ScheduleUpdate,
  ): Promise<ScheduleRecord> {
    return (await this.prismaService.backupSchedule.upsert({
      where: { serverId },
      create: { serverId, ...data },
      update: data,
    })) as ScheduleRecord;
  }
}
