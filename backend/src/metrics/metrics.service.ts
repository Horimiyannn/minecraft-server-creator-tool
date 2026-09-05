import { Injectable } from '@nestjs/common';
import { DockerService } from '../servers/docker.service';
import {
  computeCpuPct,
  computeMem,
  dirSizeBytes,
  ServerStats,
} from './metrics';

@Injectable()
export class MetricsService {
  constructor(private readonly dockerService: DockerService) {}

  async collect(containerId: string, dataDir: string): Promise<ServerStats> {
    const raw = await this.dockerService.stats(containerId);
    const mem = computeMem(raw);
    const diskBytes = await dirSizeBytes(dataDir);
    return {
      cpuPct: Math.round(computeCpuPct(raw) * 10) / 10,
      memUsedMb: mem.usedMb,
      memLimitMb: mem.limitMb,
      diskMb: Math.round(diskBytes / (1024 * 1024)),
    };
  }
}
