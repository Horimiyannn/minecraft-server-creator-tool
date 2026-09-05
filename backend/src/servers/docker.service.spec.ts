import { DockerService, RawStats } from './docker.service';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

// A fake dockerode container + client so we assert call args without a daemon.
function makeService(container: Record<string, jest.Mock>): {
  service: DockerService;
  getContainer: jest.Mock;
} {
  const getContainer = jest.fn().mockReturnValue(container);
  const configService = { get: jest.fn().mockReturnValue(undefined) };
  const service = new DockerService(configService as never);
  // Replace the private dockerode client with our fake.
  (service as unknown as { docker: { getContainer: jest.Mock } }).docker = {
    getContainer,
  };
  return { service, getContainer };
}

describe('DockerService.logs', () => {
  it('requests a following, combined stdout+stderr stream', async () => {
    const logs = jest.fn().mockResolvedValue('STREAM');
    const { service, getContainer } = makeService({ logs });
    const stream = await service.logs('c1', { tail: 50 });
    expect(getContainer).toHaveBeenCalledWith('c1');
    expect(logs).toHaveBeenCalledWith({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 50,
      timestamps: false,
    });
    expect(stream).toBe('STREAM');
  });

  it('defaults tail to 200', async () => {
    const logs = jest.fn().mockResolvedValue('S');
    const { service } = makeService({ logs });
    await service.logs('c1');
    expect(logs).toHaveBeenCalledWith(expect.objectContaining({ tail: 200 }));
  });
});

describe('DockerService.stats', () => {
  it('returns a one-shot (non-streaming) stats snapshot', async () => {
    const raw: RawStats = {
      cpu_stats: { cpu_usage: { total_usage: 0 } },
      precpu_stats: { cpu_usage: { total_usage: 0 } },
      memory_stats: {},
    };
    const stats = jest.fn().mockResolvedValue(raw);
    const { service } = makeService({ stats });
    const result = await service.stats('c1');
    expect(stats).toHaveBeenCalledWith({ stream: false });
    expect(result).toBe(raw);
  });
});

describe('DockerService.rconEndpoint', () => {
  it('reads the loopback host port bound to 25575/tcp', async () => {
    const inspect = jest.fn().mockResolvedValue({
      NetworkSettings: {
        Ports: { '25575/tcp': [{ HostIp: '127.0.0.1', HostPort: '49222' }] },
      },
    });
    const { service } = makeService({ inspect });
    await expect(service.rconEndpoint('c1')).resolves.toEqual({
      host: '127.0.0.1',
      port: 49222,
    });
  });

  it('throws when RCON is not published', async () => {
    const inspect = jest
      .fn()
      .mockResolvedValue({ NetworkSettings: { Ports: {} } });
    const { service } = makeService({ inspect });
    await expect(service.rconEndpoint('c1')).rejects.toThrow('RCON port');
  });
});

describe('DockerService.create', () => {
  it('publishes RCON on loopback, sets a TTY, and keeps the MC port', async () => {
    const createContainer = jest.fn().mockResolvedValue({ id: 'cNEW' });
    const getContainer = jest.fn();
    const configService = { get: jest.fn().mockReturnValue(undefined) };
    const service = new DockerService(configService as never);
    (service as unknown as { docker: unknown }).docker = {
      createContainer,
      getContainer,
    };
    const id = await service.create({
      id: 'srv1',
      port: 25599,
      env: ['EULA=TRUE'],
    });
    expect(id).toBe('cNEW');
    const arg = createContainer.mock.calls[0][0];
    expect(arg.Tty).toBe(true);
    expect(arg.ExposedPorts).toMatchObject({
      '25565/tcp': {},
      '25575/tcp': {},
    });
    expect(arg.HostConfig.PortBindings['25565/tcp']).toEqual([
      { HostPort: '25599' },
    ]);
    expect(arg.HostConfig.PortBindings['25575/tcp']).toEqual([
      { HostIp: '127.0.0.1', HostPort: '' },
    ]);
  });
});
