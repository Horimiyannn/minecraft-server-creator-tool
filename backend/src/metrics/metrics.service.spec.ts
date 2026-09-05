import { MetricsService } from './metrics.service';
import { DockerService, RawStats } from '../servers/docker.service';

const raw: RawStats = {
  cpu_stats: {
    cpu_usage: { total_usage: 200 },
    system_cpu_usage: 2000,
    online_cpus: 4,
  },
  precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
  memory_stats: { usage: 600 * 1024 * 1024, limit: 2048 * 1024 * 1024 },
};

describe('MetricsService.collect', () => {
  it('combines container stats with data-dir disk usage', async () => {
    const dockerService = {
      stats: jest.fn().mockResolvedValue(raw),
    } as unknown as jest.Mocked<DockerService>;
    const service = new MetricsService(dockerService);
    // Point disk at this repo dir so dirSizeBytes returns > 0.
    const result = await service.collect('c1', __dirname);
    expect(dockerService.stats).toHaveBeenCalledWith('c1');
    expect(result.cpuPct).toBeCloseTo(40);
    expect(result.memUsedMb).toBe(600);
    expect(result.memLimitMb).toBe(2048);
    expect(result.diskMb).toBeGreaterThanOrEqual(0);
  });
});
