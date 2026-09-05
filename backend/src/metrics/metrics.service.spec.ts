import { MetricsService } from './metrics.service';
import { DockerService, RawStats } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';
import { ServerStats } from './metrics';

// Keep disk-size resolution a fast microtask (no real fs) so the polling
// loop's ticks settle under fake timers.
jest.mock('node:fs/promises', () => ({
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn().mockResolvedValue({ size: 0 }),
}));

function sample(total: number): RawStats {
  return {
    cpu_stats: {
      cpu_usage: { total_usage: total },
      system_cpu_usage: total * 10,
      online_cpus: 4,
    },
    precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
    memory_stats: { usage: 600 * 1024 * 1024, limit: 2048 * 1024 * 1024 },
  };
}

function make(stats: jest.Mock) {
  const dockerService = {
    stats,
    dataDir: jest.fn().mockReturnValue('/tmp/nope'),
  } as unknown as jest.Mocked<DockerService>;
  const serversService = {
    resolveContainerId: jest.fn().mockResolvedValue('c1'),
  } as unknown as jest.Mocked<ServersService>;
  return { service: new MetricsService(dockerService, serversService), stats };
}

describe('MetricsService.subscribe', () => {
  afterEach(() => jest.useRealTimers());

  it('emits an immediate sample and one per interval', async () => {
    jest.useFakeTimers();
    const stats = jest.fn().mockResolvedValue(sample(100));
    const { service } = make(stats);
    const emitted: ServerStats[] = [];
    await service.subscribe('srv1', (s) => emitted.push(s));
    await jest.advanceTimersByTimeAsync(0); // let the immediate run() settle
    expect(emitted).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(emitted.length).toBeGreaterThanOrEqual(2);
    service.unsubscribe('srv1');
  });

  it('is idempotent — a second subscribe does not start a second loop', async () => {
    jest.useFakeTimers();
    const stats = jest.fn().mockResolvedValue(sample(100));
    const { service } = make(stats);
    await service.subscribe('srv1', () => undefined);
    await service.subscribe('srv1', () => undefined);
    stats.mockClear();
    await jest.advanceTimersByTimeAsync(2000);
    expect(stats).toHaveBeenCalledTimes(1); // one loop, not two
    service.unsubscribe('srv1');
  });

  it('stops polling after unsubscribe', async () => {
    jest.useFakeTimers();
    const stats = jest.fn().mockResolvedValue(sample(100));
    const { service } = make(stats);
    await service.subscribe('srv1', () => undefined);
    service.unsubscribe('srv1');
    stats.mockClear();
    await jest.advanceTimersByTimeAsync(4000);
    expect(stats).not.toHaveBeenCalled();
  });
});
