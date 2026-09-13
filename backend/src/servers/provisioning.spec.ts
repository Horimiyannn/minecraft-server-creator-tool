import { toItzgEnv } from './provisioning';

// ramMb is the whole container budget, so the JVM heap must leave room for
// metaspace/GC/native or the kernel OOM-kills the container instead of the
// JVM throwing a catchable OutOfMemoryError.
describe('heap sizing', () => {
  const base = {
    loader: 'vanilla' as const,
    version: '1.20.1',
    rconPassword: 'pw',
  };
  const memoryOf = (ramMb: number): string | undefined =>
    toItzgEnv({ ...base, ramMb }).find((e) => e.startsWith('MEMORY='));

  it('reserves 512M of overhead on roomy budgets', () => {
    expect(memoryOf(2048)).toBe('MEMORY=1536M');
    expect(memoryOf(8192)).toBe('MEMORY=7680M');
    expect(memoryOf(32768)).toBe('MEMORY=32256M');
  });

  it('falls back to half the budget when 512M of overhead would starve the heap', () => {
    expect(memoryOf(1024)).toBe('MEMORY=512M');
    expect(memoryOf(512)).toBe('MEMORY=256M');
  });
});

describe('toItzgEnv', () => {
  const base = { version: '1.20.1', ramMb: 2048, rconPassword: 'pw' };

  it('always sets EULA, memory, and RCON', () => {
    const env = toItzgEnv({ loader: 'vanilla', ...base });
    expect(env).toContain('EULA=TRUE');
    expect(env).toContain('MEMORY=1536M');
    expect(env).toContain('ENABLE_RCON=TRUE');
    expect(env).toContain('RCON_PASSWORD=pw');
    expect(env).toContain('VERSION=1.20.1');
  });

  it('maps each loader to its itzg TYPE', () => {
    expect(toItzgEnv({ loader: 'vanilla', ...base })).toContain('TYPE=VANILLA');
    expect(toItzgEnv({ loader: 'paper', ...base })).toContain('TYPE=PAPER');
    expect(toItzgEnv({ loader: 'forge', ...base })).toContain('TYPE=FORGE');
    expect(toItzgEnv({ loader: 'neoforge', ...base })).toContain(
      'TYPE=NEOFORGE',
    );
  });

  it('pins the loader build via the env var itzg reads for that loader', () => {
    expect(
      toItzgEnv({ loader: 'forge', ...base, loaderVersion: '47.2.0' }),
    ).toContain('FORGE_VERSION=47.2.0');
    expect(
      toItzgEnv({ loader: 'neoforge', ...base, loaderVersion: '21.1.73' }),
    ).toContain('NEOFORGE_VERSION=21.1.73');
    expect(
      toItzgEnv({ loader: 'paper', ...base, loaderVersion: '60' }),
    ).toContain('PAPER_BUILD=60');
  });

  it('omits the build var when no loader version is pinned', () => {
    for (const env of [
      toItzgEnv({ loader: 'forge', ...base }),
      toItzgEnv({ loader: 'forge', ...base, loaderVersion: null }),
      toItzgEnv({ loader: 'forge', ...base, loaderVersion: '' }),
    ]) {
      expect(env.some((e) => e.startsWith('FORGE_VERSION='))).toBe(false);
    }
  });

  it('ignores a loader version for vanilla, which has no loader jar', () => {
    const env = toItzgEnv({
      loader: 'vanilla',
      ...base,
      loaderVersion: '47.2.0',
    });
    expect(env.some((e) => e.includes('47.2.0'))).toBe(false);
  });
});
