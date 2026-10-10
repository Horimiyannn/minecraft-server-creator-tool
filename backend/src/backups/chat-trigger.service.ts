import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

@Injectable()
export class ChatTriggerService implements OnModuleInit {
  private readonly logger = new Logger(ChatTriggerService.name);
  private readonly releases = new Map<string, () => void>();
  private readonly lastUse = new Map<string, number>();
  private readonly seen = new Set<string>();

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
  }

  async watch(serverId: string): Promise<void> {
    if (this.releases.has(serverId)) return;
    const release = await this.logStreamService.subscribe(serverId, (line) =>
      this.onLine(serverId, line),
    );
    this.releases.set(serverId, release);
  }

  unwatch(serverId: string): void {
    this.releases.get(serverId)?.();
    this.releases.delete(serverId);
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
    void this.handle(serverId, parsed.player, parsed.arg);
  }

  private async handle(
    serverId: string,
    player: string,
    label?: string,
  ): Promise<void> {
    try {
      const ops = await this.readOps(serverId);
      if (!ops.some((name) => name.toLowerCase() === player.toLowerCase())) {
        await this.reply(serverId, player, 'Only server ops can run !backup.');
        return;
      }
      const key = `${serverId}:${player.toLowerCase()}`;
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
