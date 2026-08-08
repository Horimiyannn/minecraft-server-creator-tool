import { toItzgEnv } from './provisioning';

describe('toItzgEnv', () => {
  const base = { version: '1.20.1', ramMb: 2048, rconPassword: 'pw' };

  it('always sets EULA, memory, and RCON', () => {
    const env = toItzgEnv({ loader: 'vanilla', ...base });
    expect(env).toContain('EULA=TRUE');
    expect(env).toContain('MEMORY=2048M');
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
});
