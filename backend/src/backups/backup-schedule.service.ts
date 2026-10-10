import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  BackupKind,
  BackupRepository,
  ScheduleRecord,
  ScheduleUpdate,
} from './backup.repository';
import { BackupService } from './backup.service';
import { RconService } from '../console/rcon.service';
import { ChatTriggerService } from './chat-trigger.service';
import { parsePlayerCount } from './chat-command';

/** Below this, a tar of a large world can outlast its own interval. */
export const MIN_INTERVAL_MIN = 5;
export const MAX_KEEP = 20;

@Injectable()
export class BackupScheduleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupScheduleService.name);
  private readonly timers = new Map<string, NodeJS.Timeout[]>();

  constructor(
    private readonly backupRepository: BackupRepository,
    private readonly backupService: BackupService,
    private readonly rconService: RconService,
    private readonly chatTriggerService: ChatTriggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const schedule of await this.backupRepository.listSchedules()) {
      this.register(schedule);
    }
  }

  onModuleDestroy(): void {
    for (const timers of this.timers.values()) timers.forEach(clearInterval);
    this.timers.clear();
  }

  get(serverId: string): Promise<ScheduleRecord> {
    return this.backupRepository.getSchedule(serverId);
  }

  async save(
    serverId: string,
    update: ScheduleUpdate,
  ): Promise<ScheduleRecord> {
    validate(update);
    const saved = await this.backupRepository.upsertSchedule(serverId, update);
    this.register(saved);
    if (saved.chatEnabled) {
      await this.chatTriggerService
        .watch(serverId)
        .catch((error) => this.logger.warn(String(error)));
    } else {
      this.chatTriggerService.unwatch(serverId);
    }
    return saved;
  }

  /** Replace this server's timers with the ones its schedule now implies. */
  private register(schedule: ScheduleRecord): void {
    this.timers.get(schedule.serverId)?.forEach(clearInterval);
    const timers: NodeJS.Timeout[] = [];
    const add = (everyMin: number | null, kind: BackupKind): void => {
      if (!everyMin) return;
      timers.push(
        setInterval(
          () => void this.tick(schedule.serverId, kind),
          everyMin * 60 * 1000,
        ),
      );
    };
    add(schedule.worldEveryMin, 'world');
    add(schedule.fullEveryMin, 'full');
    this.timers.set(schedule.serverId, timers);
  }

  private async tick(serverId: string, kind: BackupKind): Promise<void> {
    try {
      const schedule = await this.backupRepository.getSchedule(serverId);
      if (schedule.skipWhenEmpty && !(await this.worthBackingUp(serverId))) {
        return;
      }
      await this.backupService.create(serverId, kind, 'schedule');
      this.chatTriggerService.clearPlayersSeen(serverId);
    } catch (error) {
      this.logger.warn(`scheduled ${kind} backup failed: ${String(error)}`);
    }
  }

  /**
   * "Empty" alone is not enough to skip: players who farmed for hours and
   * logged off would never get that session snapshotted. Back up when anyone
   * is online now, OR when anyone has been seen since the last backup.
   */
  private async worthBackingUp(serverId: string): Promise<boolean> {
    const output = await this.rconService
      .send(serverId, 'list')
      .catch(() => null);
    const online = output ? parsePlayerCount(output) : null;
    if (online !== null && online > 0) {
      this.chatTriggerService.markPlayersSeen(serverId);
      return true;
    }
    return this.chatTriggerService.playersSeen(serverId);
  }
}

function validate(update: ScheduleUpdate): void {
  for (const value of [update.worldEveryMin, update.fullEveryMin]) {
    if (value !== null && value < MIN_INTERVAL_MIN) {
      throw new BadRequestException(
        `interval must be at least ${MIN_INTERVAL_MIN} minutes`,
      );
    }
  }
  for (const keep of [update.keepWorld, update.keepFull]) {
    if (keep < 1 || keep > MAX_KEEP) {
      throw new BadRequestException(
        `keep count must be between 1 and ${MAX_KEEP}`,
      );
    }
  }
}
