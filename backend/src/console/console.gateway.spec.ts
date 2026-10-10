import { ConsoleGateway } from './console.gateway';
import { SocketAuthService } from '../auth/socket-auth.service';
import { LogStreamService } from './log-stream.service';
import { RconService } from './rcon.service';

function makeGateway() {
  const socketAuthService = {
    authenticate: jest.fn().mockReturnValue({ sub: 1, username: 'admin' }),
  } as unknown as jest.Mocked<SocketAuthService>;
  const release = jest.fn();
  const logStreamService = {
    subscribe: jest.fn().mockResolvedValue(release),
  } as unknown as jest.Mocked<LogStreamService>;
  const rconService = {
    send: jest.fn().mockResolvedValue('cmd-output'),
  } as unknown as jest.Mocked<RconService>;
  const gateway = new ConsoleGateway(
    socketAuthService,
    logStreamService,
    rconService,
  );
  const emit = jest.fn();
  const rooms = new Map<string, Set<string>>();
  (gateway as unknown as { server: unknown }).server = {
    to: () => ({ emit }),
    adapter: { rooms },
  };
  return {
    gateway,
    logStreamService,
    release,
    rconService,
    emit,
    rooms,
    socketAuthService,
  };
}

function fakeClient() {
  return {
    handshake: { headers: { cookie: 'mcp_token=x' } },
    data: {} as Record<string, unknown>,
    disconnect: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    on: jest.fn(),
    emit: jest.fn(),
  };
}

describe('ConsoleGateway', () => {
  it('disconnects a client that fails authentication', () => {
    const { gateway, socketAuthService } = makeGateway();
    socketAuthService.authenticate = jest.fn(() => {
      throw new Error('no');
    }) as never;
    const client = fakeClient();
    gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('subscribes to logs on join and forwards lines to the room', async () => {
    const { gateway, logStreamService, emit } = makeGateway();
    const client = fakeClient();
    await gateway.join(client as never, { serverId: 'srv1' });
    expect(client.join).toHaveBeenCalledWith('server:srv1');
    expect(logStreamService.subscribe).toHaveBeenCalledWith(
      'srv1',
      expect.any(Function),
    );
    const sink = logStreamService.subscribe.mock.calls[0][1];
    sink('Server started!');
    expect(emit).toHaveBeenCalledWith('log', {
      serverId: 'srv1',
      line: 'Server started!',
    });
  });

  it('routes a command through RconService and replies with output', async () => {
    const { gateway, rconService } = makeGateway();
    const client = fakeClient();
    await gateway.command(client as never, {
      serverId: 'srv1',
      command: 'list',
    });
    expect(rconService.send).toHaveBeenCalledWith('srv1', 'list');
    expect(client.emit).toHaveBeenCalledWith('output', {
      serverId: 'srv1',
      output: 'cmd-output',
    });
  });

  it('emits an error frame when the command fails', async () => {
    const { gateway, rconService } = makeGateway();
    rconService.send = jest.fn().mockRejectedValue(new Error('offline'));
    const client = fakeClient();
    await gateway.command(client as never, {
      serverId: 'srv1',
      command: 'list',
    });
    expect(client.emit).toHaveBeenCalledWith('error', { message: 'offline' });
  });

  it('releases the log listener when the last viewer leaves', async () => {
    const { gateway, release, rooms } = makeGateway();
    const client = fakeClient();
    rooms.set('server:srv1', new Set(['sock1']));
    await gateway.join(client as never, { serverId: 'srv1' });

    rooms.set('server:srv1', new Set());
    await gateway.leave(client as never, { serverId: 'srv1' });

    expect(release).toHaveBeenCalled();
  });
});
