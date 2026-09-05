import { MetricsGateway } from './metrics.gateway';
import { SocketAuthService } from '../auth/socket-auth.service';
import { MetricsService } from './metrics.service';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';

function makeGateway() {
  const socketAuthService = {
    authenticate: jest.fn().mockReturnValue({ sub: 1, username: 'admin' }),
  } as unknown as jest.Mocked<SocketAuthService>;
  const metricsService = {
    collect: jest.fn().mockResolvedValue({
      cpuPct: 12,
      memUsedMb: 500,
      memLimitMb: 2048,
      diskMb: 42,
    }),
  } as unknown as jest.Mocked<MetricsService>;
  const dockerService = {
    dataDir: jest.fn().mockReturnValue('/srv/mc/srv1/data'),
  } as unknown as jest.Mocked<DockerService>;
  const serversService = {
    resolveContainerId: jest.fn().mockResolvedValue('c1'),
  } as unknown as jest.Mocked<ServersService>;
  const gateway = new MetricsGateway(
    socketAuthService,
    metricsService,
    dockerService,
    serversService,
  );
  const emit = jest.fn();
  (gateway as unknown as { server: unknown }).server = {
    to: () => ({ emit }),
  };
  return { gateway, emit, metricsService };
}

function fakeClient() {
  return {
    handshake: { headers: { cookie: 'mcp_token=x' } },
    data: {} as Record<string, unknown>,
    disconnect: jest.fn(),
    join: jest.fn(),
    rooms: new Set<string>(),
  };
}

describe('MetricsGateway', () => {
  afterEach(() => jest.useRealTimers());

  it('emits a stats tick after joining', async () => {
    jest.useFakeTimers();
    const { gateway, emit, metricsService } = makeGateway();
    const client = fakeClient();
    await gateway.join(client as never, { serverId: 'srv1' });
    await jest.advanceTimersByTimeAsync(2000);
    expect(metricsService.collect).toHaveBeenCalledWith(
      'c1',
      '/srv/mc/srv1/data',
    );
    expect(emit).toHaveBeenCalledWith(
      'stats',
      expect.objectContaining({ serverId: 'srv1', cpuPct: 12 }),
    );
    gateway.leave(client as never, { serverId: 'srv1' });
  });

  it('stops polling when the last subscriber leaves', async () => {
    jest.useFakeTimers();
    const { gateway, metricsService } = makeGateway();
    const client = fakeClient();
    await gateway.join(client as never, { serverId: 'srv1' });
    gateway.leave(client as never, { serverId: 'srv1' });
    metricsService.collect.mockClear();
    await jest.advanceTimersByTimeAsync(4000);
    expect(metricsService.collect).not.toHaveBeenCalled();
  });
});
