import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { LogStreamService } from '../console/log-stream.service';
import { RconService } from '../console/rcon.service';
import { DockerService } from '../servers/docker.service';
import { BackupService } from './backup.service';
import { BackupRepository } from './backup.repository';
import { isJoinLine, parseChatCommand } from './chat-command';

/** One backup per player per server per this window. */
const RATE_LIMIT_MS = 5 * 60 * 1000;
/** A refused player gets one reply per this window, not one per chat line. */
const REFUSAL_THROTTLE_MS = 60 * 1000;
/**
 * The docker log stream replays the last 200 lines on attach, so a `!backup`
 * from before a panel restart would run again. Ignore commands for a moment
 * after attaching; replayed lines all arrive in the first burst.
 */
const REPLAY_GRACE_MS = 2 * 1000;
/** How often to retry servers that should be watched but are not attached. */
const RETRY_EVERY_MS = 60 * 1000;

@Injectable()
export class ChatTriggerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatTriggerService.name);
  private readonly releases = new Map<string, () => void>();
  private readonly attaching = new Map<string, Promise<void>>();
  /** Servers that should be watched, attached or not (container may be down). */
  private readonly wanted = new Set<string>();
  private readonly attachedAt = new Map<string, number>();
  private readonly lastUse = new Map<string, number>();
  private readonly lastRefusal = new Map<string, number>();
  private readonly seen = new Set<string>();
  private retryTimer?: NodeJS.Timeout;

  constructor(
    private readonly logStreamService: LogStreamService,
    private readonly rconService: RconService,
    private readonly backupService: BackupService,
    private readonly backupRepository: BackupRepository,
    private readonly dockerService: DockerService,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const schedule of await this.backupRepository.listSchedules()) {
      if (schedule.chatEnabled) {
        await this.watch(schedule.serverId).catch((error) =>
          this.logger.warn(
            `chat trigger not attached for ${schedule.serverId}: ${String(error)}`,
          ),
        );
      }
    }
    // A stopped container has no log stream, and a running one loses its
    // stream on every restart; retry so !backup does not die with it.
    this.retryTimer = setInterval(
      () => void this.retryWanted(),
      RETRY_EVERY_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
    for (const serverId of [...this.releases.keys()]) this.unwatch(serverId);
  }

  async watch(serverId: string): Promise<void> {
    this.wanted.add(serverId);
    await this.attach(serverId);
  }

  unwatch(serverId: string): void {
    this.wanted.delete(serverId);
    this.releases.get(serverId)?.();
    this.releases.delete(serverId);
    this.attachedAt.delete(serverId);
  }

  /** Single-flight: a boot sweep racing a schedule save must attach once. */
  private attach(serverId: string): Promise<void> {
    if (this.releases.has(serverId)) return Promise.resolve();
    const pending = this.attaching.get(serverId);
    if (pending) return pending;

    const promise = (async () => {
      const release = await this.logStreamService.subscribe(
        serverId,
        (line) => this.onLine(serverId, line),
        () => this.onStreamEnd(serverId),
      );
      this.releases.set(serverId, release);
      this.attachedAt.set(serverId, Date.now());
    })().finally(() => this.attaching.delete(serverId));

    this.attaching.set(serverId, promise);
    return promise;
  }

  /** The container stopped: the handle is dead, so drop it and try again. */
  private onStreamEnd(serverId: string): void {
    this.releases.delete(serverId);
    this.attachedAt.delete(serverId);
  }

  private async retryWanted(): Promise<void> {
    for (const serverId of this.wanted) {
      if (this.releases.has(serverId)) continue;
      await this.attach(serverId).catch(() => undefined); // container still down
    }
  }

  /** Has anyone been on since the last backup? Used by skipWhenEmpty. */
  playersSeen(serverId: string): boolean {
    return this.seen.has(serverId);
  }

  markPlayersSeen(serverId: string): void {
    this.seen.add(serverId);
  }

  clearPlayersSeen(serverId: string): void {
    this.seen.delete(serverId);
  }

  private onLine(serverId: string, line: string): void {
    if (isJoinLine(line)) this.seen.add(serverId);
    const parsed = parseChatCommand(line);
    // Chat may take world backups and nothing else: no restore, no listing.
    if (!parsed || parsed.command !== 'backup') return;
    const attachedAt = this.attachedAt.get(serverId) ?? 0;
    if (Date.now() - attachedAt < REPLAY_GRACE_MS) {
      this.logger.debug(`ignoring replayed !backup for ${serverId}`);
      return;
    }
    void this.handle(serverId, parsed.player, parsed.arg);
  }

  private async handle(
    serverId: string,
    player: string,
    label?: string,
  ): Promise<void> {
    const key = `${serverId}:${player.toLowerCase()}`;
    try {
      // Checked before the ops.json read so a spamming player costs one file
      // read and one RCON reply per minute, not one per chat line.
      const refusedAt = this.lastRefusal.get(key) ?? 0;
      if (Date.now() - refusedAt < REFUSAL_THROTTLE_MS) return;
      const ops = await this.readOps(serverId);
      if (!ops.some((name) => name.toLowerCase() === player.toLowerCase())) {
        this.lastRefusal.set(key, Date.now());
        await this.reply(serverId, player, 'Only server ops can run !backup.');
        return;
      }
      const last = this.lastUse.get(key) ?? 0;
      if (Date.now() - last < RATE_LIMIT_MS) {
        await this.reply(
          serverId,
          player,
          'You backed up recently — please wait a few minutes.',
        );
        return;
      }
      this.lastUse.set(key, Date.now());

      await this.reply(serverId, player, 'Backing up the world…');
      const record = await this.backupService.create(
        serverId,
        'world',
        'chat',
        label,
      );
      this.clearPlayersSeen(serverId);
      await this.reply(
        serverId,
        player,
        `World backup done (${formatMb(record.sizeBytes)} MB).`,
      );
    } catch (error) {
      this.logger.warn(`chat backup failed for ${serverId}: ${String(error)}`);
      await this.reply(
        serverId,
        player,
        'Backup failed — check the panel.',
      ).catch(() => undefined);
    }
  }

  private async readOps(serverId: string): Promise<string[]> {
    // Re-read per command: op status changes in game and must take effect at
    // once, and the file is a few hundred bytes.
    const raw = await readFile(
      path.join(this.dockerService.dataDir(serverId), 'ops.json'),
      'utf8',
    ).catch(() => '[]');
    const parsed = JSON.parse(raw) as { name?: string }[];
    return parsed.map((entry) => entry.name ?? '').filter(Boolean);
  }

  private reply(
    serverId: string,
    player: string,
    text: string,
  ): Promise<string> {
    return this.rconService.send(
      serverId,
      `tellraw ${player} ${JSON.stringify({ text: `[backup] ${text}`, color: 'gray' })}`,
    );
  }
}

function formatMb(bytes: bigint): string {
  return (Number(bytes) / (1024 * 1024)).toFixed(1);
}
