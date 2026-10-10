import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
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
  isSafeDirName,
  levelName,
  worldDirs,
} from './archive-paths';

/** Pause after `save-all flush` so the chunk writer lands before tar reads. */
const FLUSH_SETTLE_MS = 750;

@Injectable()
export class BackupService implements OnApplicationShutdown {
  private readonly logger = new Logger(BackupService.name);
  /** Per-server single-flight: schedule, chat and button cannot overlap. */
  private readonly running = new Set<string>();
  /** Servers whose saves this process has disabled and not yet re-enabled. */
  private readonly savesOff = new Set<string>();

  constructor(
    private readonly backupRepository: BackupRepository,
    private readonly tarService: TarService,
    private readonly serversService: ServersService,
    private readonly dockerService: DockerService,
    private readonly rconService: RconService,
  ) {}

  /**
   * A panel restart mid-backup would otherwise leave the Minecraft server
   * with saves disabled indefinitely — the one unacceptable outcome.
   */
  async onApplicationShutdown(): Promise<void> {
    for (const serverId of [...this.savesOff]) {
      await this.saveOn(serverId);
    }
  }

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

    try {
      if (live) {
        // Inside the try: if the send rejects after the server ran it (read
        // timeout, dropped reply), save-on must still happen.
        this.savesOff.add(serverId);
        await this.rconService.send(serverId, 'save-off');
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
      await this.saveOn(serverId);
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

  private async saveOn(serverId: string): Promise<void> {
    if (!this.savesOff.has(serverId)) return;
    this.savesOff.delete(serverId);
    await this.rconService
      .send(serverId, 'save-on')
      .catch((error) =>
        this.logger.error(`save-on failed for ${serverId}: ${String(error)}`),
      );
  }

  /** World snapshots take the level's dimension folders; full takes it all. */
  private async pathsFor(
    serverId: string,
    kind: BackupKind,
    dataDir: string,
  ): Promise<string[]> {
    if (kind === 'full') return ['.'];
    const dirs = await this.liveWorldDirs(dataDir);
    if (dirs.length === 0) {
      throw new Error(`server "${serverId}" has no world directory yet`);
    }
    return dirs;
  }

  /** The dimension folders the current `level-name` points at, guarded. */
  private async liveWorldDirs(dataDir: string): Promise<string[]> {
    const properties = await readFile(
      path.join(dataDir, 'server.properties'),
      'utf8',
    ).catch(() => '');
    const level = levelName(properties);
    if (!isSafeDirName(level)) {
      throw new BadRequestException(
        `level-name "${level}" is not a usable directory name`,
      );
    }
    const existing = await readdir(dataDir).catch(() => [] as string[]);
    return worldDirs(level, existing);
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
    const dirs = await this.liveWorldDirs(dataDir);
    const aside = new Map<string, string>();
    const rollback = async (): Promise<void> => {
      for (const [from, to] of aside) {
        await rm(from, { recursive: true, force: true });
        await rename(to, from);
      }
    };
    try {
      // Inside the try: a failure partway through the renames must not leave
      // a dimension parked under `.restoring-` with nothing live in its place.
      for (const dir of dirs) {
        const from = path.join(dataDir, dir);
        const to = `${from}.restoring-${Date.now()}`;
        await rename(from, to);
        aside.set(from, to);
      }
      await this.tarService.extract({ archive, dest: dataDir });
      // The archive was taken under whatever level-name was live then. If it
      // does not put every displaced dimension back, dropping the copies we
      // moved aside would destroy the live world and report success.
      const missing: string[] = [];
      for (const from of aside.keys()) {
        const back = await stat(from).catch(() => null);
        if (!back?.isDirectory()) missing.push(path.basename(from));
      }
      if (missing.length > 0) {
        throw new BadRequestException(
          `this backup does not contain ${missing.join(', ')} — it was taken under a different level-name, so restoring it would replace nothing`,
        );
      }
    } catch (error) {
      await rollback();
      throw error;
    }
    for (const to of aside.values()) {
      await rm(to, { recursive: true, force: true });
    }
  }

  async list(serverId: string): Promise<BackupRecord[]> {
    await this.serversService.assertServerExists(serverId);
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
    // Rows can outlive their files (a failed prune unlink); streaming a
    // missing path would send headers and then abort mid-download.
    const info = await stat(record.path).catch(() => null);
    if (!info?.isFile()) {
      throw new NotFoundException(
        `the archive for backup "${backupId}" is no longer on disk`,
      );
    }
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
