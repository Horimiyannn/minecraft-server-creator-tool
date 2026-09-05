import { ConsoleGateway } from './console.gateway';
import { SocketAuthService } from '../auth/socket-auth.service';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';
import { RconService } from './rcon.service';

function makeDeps() {
  const socketAuthService = {
    authenticate: jest.fn().mockReturnValue({ sub: 1, username: 'admin' }),
  } as unknown as jest.Mocked<SocketAuthService>;
  const dockerService = {
    logs: jest.fn(),
  } as unknown as jest.Mocked<DockerService>;
  const serversService = {
    resolveContainerId: jest.fn().mockResolvedValue('c1'),
  } as unknown as jest.Mocked<ServersService>;
  const rconService = {
    send: jest.fn().mockResolvedValue('cmd-output'),
  } as unknown as jest.Mocked<RconService>;
  return { socketAuthService, dockerService, serversService, rconService };
}

function makeGateway(deps: ReturnType<typeof makeDeps>) {
  return new ConsoleGateway(
    deps.socketAuthService,
    deps.dockerService,
    deps.serversService,
    deps.rconService,
  );
}

function fakeClient() {
  return {
    handshake: { headers: { cookie: 'mcp_token=x' } },
    data: {} as Record<string, unknown>,
    disconnect: jest.fn(),
    emit: jest.fn(),
  };
}

describe('ConsoleGateway', () => {
  it('disconnects a client that fails authentication', () => {
    const deps = makeDeps();
    deps.socketAuthService.authenticate = jest.fn(() => {
      throw new Error('no');
    }) as never;
    const gateway = makeGateway(deps);
    const client = fakeClient();
    gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('routes a command through RconService and replies with output', async () => {
    const deps = makeDeps();
    const gateway = makeGateway(deps);
    const client = fakeClient();
    await gateway.command(client as never, {
      serverId: 'srv1',
      command: 'list',
    });
    expect(deps.rconService.send).toHaveBeenCalledWith('srv1', 'list');
    expect(client.emit).toHaveBeenCalledWith('output', {
      serverId: 'srv1',
      output: 'cmd-output',
    });
  });

  it('emits an error frame when the command fails', async () => {
    const deps = makeDeps();
    deps.rconService.send = jest.fn().mockRejectedValue(new Error('offline'));
    const gateway = makeGateway(deps);
    const client = fakeClient();
    await gateway.command(client as never, {
      serverId: 'srv1',
      command: 'list',
    });
    expect(client.emit).toHaveBeenCalledWith('error', { message: 'offline' });
  });
});
