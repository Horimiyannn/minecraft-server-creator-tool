const createContainer = jest.fn();
const getContainer = jest.fn();

jest.mock('dockerode', () =>
  jest.fn().mockImplementation(() => ({ createContainer, getContainer })),
);
jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

import { mkdir } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { DockerService } from './docker.service';

function makeService(): DockerService {
  const configService = {
    get: (key: string) =>
      key === 'MC_DATA_ROOT' ? '/tmp/mc' : 'itzg/minecraft-server',
  } as unknown as ConfigService;
  return new DockerService(configService);
}

describe('DockerService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a container with the correct image, name, bind, port, and env', async () => {
    createContainer.mockResolvedValue({ id: 'container123' });
    const svc = makeService();

    const id = await svc.create({
      id: 'srv1',
      port: 25565,
      env: ['EULA=TRUE', 'TYPE=VANILLA'],
    });

    expect(id).toBe('container123');
    expect(mkdir).toHaveBeenCalledWith('/tmp/mc/srv1/data', {
      recursive: true,
    });
    const cfg = createContainer.mock.calls[0][0];
    expect(cfg.Image).toBe('itzg/minecraft-server');
    expect(cfg.name).toBe('mc-server-srv1');
    expect(cfg.Env).toEqual(['EULA=TRUE', 'TYPE=VANILLA']);
    expect(cfg.HostConfig.Binds).toEqual(['/tmp/mc/srv1/data:/data']);
    expect(cfg.HostConfig.PortBindings['25565/tcp']).toEqual([
      { HostPort: '25565' },
    ]);
  });

  it('start delegates to the container', async () => {
    const start = jest.fn().mockResolvedValue(undefined);
    getContainer.mockReturnValue({ start });
    await makeService().start('c1');
    expect(getContainer).toHaveBeenCalledWith('c1');
    expect(start).toHaveBeenCalled();
  });

  it('stop swallows an already-stopped (304) error', async () => {
    const stop = jest.fn().mockRejectedValue({ statusCode: 304 });
    getContainer.mockReturnValue({ stop });
    await expect(makeService().stop('c1')).resolves.toBeUndefined();
  });

  it('inspect maps running state', async () => {
    const inspect = jest
      .fn()
      .mockResolvedValue({ State: { Running: true, Status: 'running' } });
    getContainer.mockReturnValue({ inspect });
    await expect(makeService().inspect('c1')).resolves.toEqual({
      running: true,
      status: 'running',
    });
  });
});
