import { MetricsGateway } from './metrics.gateway';
import { SocketAuthService } from '../auth/socket-auth.service';
import { MetricsService } from './metrics.service';

function makeGateway() {
  const socketAuthService = {
    authenticate: jest.fn().mockReturnValue({ sub: 1, username: 'admin' }),
  } as unknown as jest.Mocked<SocketAuthService>;
  const metricsService = {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn(),
  } as unknown as jest.Mocked<MetricsService>;
  const gateway = new MetricsGateway(socketAuthService, metricsService);
  const emit = jest.fn();
  const rooms = new Map<string, Set<string>>();
  (gateway as unknown as { server: unknown }).server = {
    to: () => ({ emit }),
    adapter: { rooms },
  };
  return { gateway, metricsService, emit, rooms, socketAuthService };
}

function fakeClient() {
  return {
    handshake: { headers: { cookie: 'mcp_token=x' } },
    data: {} as Record<string, unknown>,
    disconnect: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    on: jest.fn(),
  };
}

describe('MetricsGateway', () => {
  it('disconnects a client that fails authentication', () => {
    const { gateway, socketAuthService } = makeGateway();
    socketAuthService.authenticate = jest.fn(() => {
      throw new Error('no');
    }) as never;
    const client = fakeClient();
    gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('subscribes on join and forwards stats to the room', async () => {
    const { gateway, metricsService, emit } = makeGateway();
    const client = fakeClient();
    await gateway.join(client as never, { serverId: 'srv1' });
    expect(client.join).toHaveBeenCalledWith('server:srv1');
    expect(metricsService.subscribe).toHaveBeenCalledWith(
      'srv1',
      expect.any(Function),
    );
    // Drive the emit callback the gateway handed the service.
    const sink = metricsService.subscribe.mock.calls[0][1];
    sink({ cpuPct: 3, memUsedMb: 1, memLimitMb: 2, diskMb: 0 });
    expect(emit).toHaveBeenCalledWith(
      'stats',
      expect.objectContaining({ serverId: 'srv1', cpuPct: 3 }),
    );
  });

  it('unsubscribes when the last subscriber leaves', async () => {
    const { gateway, metricsService, rooms } = makeGateway();
    const client = fakeClient();
    rooms.set('server:srv1', new Set()); // empty after leave
    await gateway.leave(client as never, { serverId: 'srv1' });
    expect(metricsService.unsubscribe).toHaveBeenCalledWith('srv1');
  });

  it('keeps polling while other subscribers remain', async () => {
    const { gateway, metricsService, rooms } = makeGateway();
    const client = fakeClient();
    rooms.set('server:srv1', new Set(['other'])); // someone still watching
    await gateway.leave(client as never, { serverId: 'srv1' });
    expect(metricsService.unsubscribe).not.toHaveBeenCalled();
  });
});
