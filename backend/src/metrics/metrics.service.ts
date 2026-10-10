import { Injectable } from '@nestjs/common';
import { DockerService, RawStats } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';
import { BackupRepository } from '../backups/backup.repository';
import {
  computeCpuPct,
  computeMem,
  dirSizeBytes,
  ServerStats,
} from './metrics';

const POLL_MS = 2000;
const DISK_EVERY = 5; // recompute disk usage every Nth tick (it walks the tree)

interface Poll {
  timer: NodeJS.Timeout;
}

/**
 * Owns one stats-polling loop per server and pushes each sample to a
 * caller-supplied sink. `subscribe` is idempotent per server; `unsubscribe`
 * stops the loop when the last viewer leaves. CPU% is derived from the delta
 * between consecutive samples (a single `stats` read has a zeroed
 * `precpu_stats`, which would report cumulative-average CPU, not live load).
 */
@Injectable()
export class MetricsService {
  private readonly polls = new Map<string, Poll>();
  private readonly starting = new Set<string>();

  constructor(
    private readonly dockerService: DockerService,
    private readonly serversService: ServersService,
    private readonly backupRepository: BackupRepository,
  ) {}

  async subscribe(
    serverId: string,
    emit: (stats: ServerStats) => void,
  ): Promise<void> {
    if (this.polls.has(serverId) || this.starting.has(serverId)) return;
    this.starting.add(serverId);
    try {
      const containerId =
        await this.serversService.resolveContainerId(serverId);
      const dataDir = this.dockerService.dataDir(serverId);
      let prevCpu: RawStats['cpu_stats'] | undefined;
      let diskMb = 0;
      let backupsMb = 0;
      let tick = 0;

      const run = async (): Promise<void> => {
        try {
          const cur = await this.dockerService.stats(containerId);
          // Feed the previous sample's cpu_stats as precpu so computeCpuPct
          // yields the delta over this interval, not cumulative usage.
          const raw = prevCpu ? { ...cur, precpu_stats: prevCpu } : cur;
          prevCpu = cur.cpu_stats;
          if (tick % DISK_EVERY === 0) {
            diskMb = Math.round((await dirSizeBytes(dataDir)) / (1024 * 1024));
            // Backups live outside the data dir, so they are a separate
            // figure — and a SQL sum rather than another tree walk.
            backupsMb = Math.round(
              Number(await this.backupRepository.totalBytes(serverId)) /
                (1024 * 1024),
            );
          }
          tick += 1;
          const mem = computeMem(cur);
          emit({
            cpuPct: Math.round(computeCpuPct(raw) * 10) / 10,
            memUsedMb: mem.usedMb,
            memLimitMb: mem.limitMb,
            diskMb,
            backupsMb,
          });
        } catch {
          // transient (container restarting) — skip this tick
        }
      };

      const timer = setInterval(() => void run(), POLL_MS);
      this.polls.set(serverId, { timer });
      void run(); // emit an immediate first sample
    } finally {
      this.starting.delete(serverId);
    }
  }

  unsubscribe(serverId: string): void {
    const poll = this.polls.get(serverId);
    if (!poll) return;
    clearInterval(poll.timer);
    this.polls.delete(serverId);
  }
}
