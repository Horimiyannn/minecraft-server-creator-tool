import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';
import {
  BackupKind,
  BackupRecord,
  BackupRepository,
  BackupTrigger,
} from './backup.repository';
import { TarService } from './tar.service';
import { ServersService } from '../servers/servers.service';
import { DockerService } from '../servers/docker.service';
import { RconService } from '../console/rcon.service';
import {
  archiveName,
  FULL_EXCLUDES,
  levelName,
  worldDirs,
} from './archive-paths';

/** Pause after `save-all flush` so the chunk writer lands before tar reads. */
const FLUSH_SETTLE_MS = 750;

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  /** Per-server single-flight: schedule, chat and button cannot overlap. */
  private readonly running = new Set<string>();

  constructor(
    private readonly backupRepository: BackupRepository,
    private readonly tarService: TarService,
    private readonly serversService: ServersService,
    private readonly dockerService: DockerService,
    private readonly rconService: RconService,
  ) {}

  async create(
    serverId: string,
    kind: BackupKind,
    trigger: BackupTrigger,
    label?: string | null,
  ): Promise<BackupRecord> {
    await this.serversService.assertServerExists(serverId);
    if (this.running.has(serverId)) {
      throw new ConflictException(
        'a backup is already running for this server',
      );
    }
    this.running.add(serverId);
    try {
      return await this.run(serverId, kind, trigger, label);
    } finally {
      this.running.delete(serverId);
    }
  }

  private async run(
    serverId: string,
    kind: BackupKind,
    trigger: BackupTrigger,
    label?: string | null,
  ): Promise<BackupRecord> {
    const dataDir = this.dockerService.dataDir(serverId);
    const backupsDir = path.join(
      this.dockerService.serverRoot(serverId),
      'backups',
    );
    await mkdir(backupsDir, { recursive: true });

    const dest = path.join(backupsDir, archiveName(kind, new Date(), label));
    const paths = await this.pathsFor(serverId, kind, dataDir);
    const live = await this.isRunning(serverId);

    if (live) await this.rconService.send(serverId, 'save-off');
    try {
      if (live) {
        await this.rconService.send(serverId, 'save-all flush');
        await delay(FLUSH_SETTLE_MS);
      }
      await this.tarService.create({
        cwd: dataDir,
        paths,
        excludes: kind === 'full' ? FULL_EXCLUDES : undefined,
        dest,
      });
    } catch (error) {
      await rm(dest, { force: true });
      throw error;
    } finally {
      // Non-negotiable: a server left with saves disabled silently loses
      // everything on the next crash.
      if (live) {
        await this.rconService
          .send(serverId, 'save-on')
          .catch((error) =>
            this.logger.error(
              `save-on failed for ${serverId}: ${String(error)}`,
            ),
          );
      }
    }

    const info = await stat(dest);
    const record = await this.backupRepository.create({
      serverId,
      kind,
      trigger,
      label: label ?? null,
      path: dest,
      sizeBytes: BigInt(info.size),
    });
    await this.prune(serverId, kind);
    return record;
  }

  /** World snapshots take the level's dimension folders; full takes it all. */
  private async pathsFor(
    serverId: string,
    kind: BackupKind,
    dataDir: string,
  ): Promise<string[]> {
    if (kind === 'full') return ['.'];
    const properties = await readFile(
      path.join(dataDir, 'server.properties'),
      'utf8',
    ).catch(() => '');
    const existing = await readdir(dataDir).catch(() => [] as string[]);
    const dirs = worldDirs(levelName(properties), existing);
    if (dirs.length === 0) {
      throw new Error(`server "${serverId}" has no world directory yet`);
    }
    return dirs;
  }

  private async isRunning(serverId: string): Promise<boolean> {
    const containerId = await this.serversService
      .resolveContainerId(serverId)
      .catch(() => null);
    if (!containerId) return false;
    const status = await this.dockerService
      .inspect(containerId)
      .catch(() => null);
    return status?.running === true;
  }

  private async prune(serverId: string, kind: BackupKind): Promise<void> {
    const schedule = await this.backupRepository.getSchedule(serverId);
    const keep = kind === 'world' ? schedule.keepWorld : schedule.keepFull;
    const rows = await this.backupRepository.listByKindOldestFirst(
      serverId,
      kind,
    );
    for (const row of rows.slice(0, Math.max(0, rows.length - keep))) {
      await rm(row.path, { force: true }).catch(() => undefined);
      await this.backupRepository.delete(row.id).catch(() => undefined);
    }
  }

  /**
   * Panel-only: restore stops the server, replaces files, and restarts it if
   * it was running. A full restore moves the live data dir aside instead of
   * deleting it, so a failed extraction can be rolled back — that rename is
   * the undo, which is why restore needs no pre-snapshot of its own.
   */
  async restore(serverId: string, backupId: string): Promise<void> {
    await this.serversService.assertServerExists(serverId);
    if (this.running.has(serverId)) {
      throw new ConflictException(
        'a backup is already running for this server',
      );
    }
    this.running.add(serverId);
    try {
      const record = await this.requireBackup(serverId, backupId);
      const wasRunning = await this.isRunning(serverId);
      if (wasRunning) await this.serversService.stop(serverId);
      try {
        if (record.kind === 'full') {
          await this.restoreFull(serverId, record.path);
        } else {
          await this.restoreWorld(serverId, record.path);
        }
      } finally {
        if (wasRunning) await this.serversService.start(serverId);
      }
    } finally {
      this.running.delete(serverId);
    }
  }

  private async restoreFull(serverId: string, archive: string): Promise<void> {
    const dataDir = this.dockerService.dataDir(serverId);
    const aside = `${dataDir}.restoring-${Date.now()}`;
    await rename(dataDir, aside);
    await mkdir(dataDir, { recursive: true });
    try {
      await this.tarService.extract({ archive, dest: dataDir });
    } catch (error) {
      await rm(dataDir, { recursive: true, force: true });
      await rename(aside, dataDir);
      throw error;
    }
    await rm(aside, { recursive: true, force: true });
  }

  /** World restore replaces the dimension folders in place, nothing else. */
  private async restoreWorld(serverId: string, archive: string): Promise<void> {
    const dataDir = this.dockerService.dataDir(serverId);
    const properties = await readFile(
      path.join(dataDir, 'server.properties'),
      'utf8',
    ).catch(() => '');
    const existing = await readdir(dataDir).catch(() => [] as string[]);
    const dirs = worldDirs(levelName(properties), existing);
    const aside = new Map<string, string>();
    for (const dir of dirs) {
      const from = path.join(dataDir, dir);
      const to = `${from}.restoring-${Date.now()}`;
      await rename(from, to);
      aside.set(from, to);
    }
    try {
      await this.tarService.extract({ archive, dest: dataDir });
    } catch (error) {
      for (const [from, to] of aside) {
        await rm(from, { recursive: true, force: true });
        await rename(to, from);
      }
      throw error;
    }
    for (const to of aside.values()) {
      await rm(to, { recursive: true, force: true });
    }
  }

  list(serverId: string): Promise<BackupRecord[]> {
    return this.backupRepository.listByServer(serverId);
  }

  totalBytes(serverId: string): Promise<bigint> {
    return this.backupRepository.totalBytes(serverId);
  }

  async remove(serverId: string, backupId: string): Promise<void> {
    const record = await this.requireBackup(serverId, backupId);
    await rm(record.path, { force: true }).catch(() => undefined);
    await this.backupRepository.delete(record.id);
  }

  async pathFor(
    serverId: string,
    backupId: string,
  ): Promise<{ path: string; filename: string }> {
    const record = await this.requireBackup(serverId, backupId);
    return { path: record.path, filename: path.basename(record.path) };
  }

  async requireBackup(
    serverId: string,
    backupId: string,
  ): Promise<BackupRecord> {
    const record = await this.backupRepository.findById(backupId);
    if (!record || record.serverId !== serverId) {
      throw new NotFoundException(`Backup "${backupId}" not found`);
    }
    return record;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
