import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { RawStats } from '../servers/docker.service';

const MB = 1024 * 1024;

export interface ServerStats {
  cpuPct: number;
  memUsedMb: number;
  memLimitMb: number;
  diskMb: number;
  /** Backup archives for this server; a SQL sum, not a tree walk. */
  backupsMb: number;
}

export function computeCpuPct(raw: RawStats): number {
  const cpuDelta =
    raw.cpu_stats.cpu_usage.total_usage -
    raw.precpu_stats.cpu_usage.total_usage;
  const sysDelta =
    (raw.cpu_stats.system_cpu_usage ?? 0) -
    (raw.precpu_stats.system_cpu_usage ?? 0);
  if (sysDelta <= 0 || cpuDelta < 0) return 0;
  const cpus =
    raw.cpu_stats.online_cpus ??
    raw.cpu_stats.cpu_usage.percpu_usage?.length ??
    1;
  return (cpuDelta / sysDelta) * cpus * 100;
}

export function computeMem(raw: RawStats): {
  usedMb: number;
  limitMb: number;
} {
  const usage = raw.memory_stats.usage ?? 0;
  const s = raw.memory_stats.stats;
  // Page cache to subtract: inactive_file on cgroup v2 (default on modern
  // hosts), cache on v1. Matches Docker's own used-memory calculation.
  const pageCache = s?.inactive_file ?? s?.total_inactive_file ?? s?.cache ?? 0;
  const limit = raw.memory_stats.limit ?? 0;
  return {
    usedMb: Math.round(Math.max(0, usage - pageCache) / MB),
    limitMb: Math.round(limit / MB),
  };
}

export async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0; // dir may not exist yet
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full);
    } else if (entry.isFile()) {
      total += (await stat(full)).size;
    }
  }
  return total;
}
