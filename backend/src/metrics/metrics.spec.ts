import { computeCpuPct, computeMem } from './metrics';
import { RawStats } from '../servers/docker.service';

function raw(over: Partial<RawStats> = {}): RawStats {
  return {
    cpu_stats: {
      cpu_usage: { total_usage: 200 },
      system_cpu_usage: 2000,
      online_cpus: 4,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 100 },
      system_cpu_usage: 1000,
    },
    memory_stats: { usage: 600 * 1024 * 1024, limit: 2048 * 1024 * 1024 },
    ...over,
  };
}

describe('computeCpuPct', () => {
  it('scales the cpu delta over the system delta by online cpus', () => {
    // cpuDelta=100, sysDelta=1000 -> 0.1 * 4 * 100 = 40%
    expect(computeCpuPct(raw())).toBeCloseTo(40);
  });

  it('is 0 when the system delta is 0 (first sample)', () => {
    expect(
      computeCpuPct(
        raw({
          cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
          precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
        }),
      ),
    ).toBe(0);
  });

  it('falls back to percpu length when online_cpus is absent', () => {
    expect(
      computeCpuPct(
        raw({
          cpu_stats: {
            cpu_usage: { total_usage: 200, percpu_usage: [1, 2] },
            system_cpu_usage: 2000,
          },
        }),
      ),
    ).toBeCloseTo(20); // 0.1 * 2 * 100
  });
});

describe('computeMem', () => {
  it('subtracts page cache and reports MiB', () => {
    const r = raw({
      memory_stats: {
        usage: 600 * 1024 * 1024,
        limit: 2048 * 1024 * 1024,
        stats: { cache: 100 * 1024 * 1024 },
      },
    });
    expect(computeMem(r)).toEqual({ usedMb: 500, limitMb: 2048 });
  });

  it('handles missing fields as zero', () => {
    expect(computeMem(raw({ memory_stats: {} }))).toEqual({
      usedMb: 0,
      limitMb: 0,
    });
  });
});
