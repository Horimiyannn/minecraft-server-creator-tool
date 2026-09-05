import { RconService } from './rcon.service';
import { ServersService } from '../servers/servers.service';
import { Rcon } from 'rcon-client';

jest.mock('rcon-client');

const target = { host: '127.0.0.1', port: 49222, password: 'pw' };

function makeServers(): jest.Mocked<ServersService> {
  return {
    getRconTarget: jest.fn().mockResolvedValue(target),
  } as unknown as jest.Mocked<ServersService>;
}

function fakeRcon(send: jest.Mock) {
  return { send, end: jest.fn().mockResolvedValue(undefined), on: jest.fn() };
}

describe('RconService.send', () => {
  const connect = Rcon.connect as jest.Mock;

  beforeEach(() => connect.mockReset());

  it('connects once and reuses the pooled connection', async () => {
    const send = jest.fn().mockResolvedValue('There are 0 players');
    connect.mockResolvedValue(fakeRcon(send));
    const service = new RconService(makeServers());

    const first = await service.send('srv1', 'list');
    const second = await service.send('srv1', 'list');

    expect(first).toBe('There are 0 players');
    expect(second).toBe('There are 0 players');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 49222,
      password: 'pw',
    });
  });

  it('evicts the connection and rethrows when send fails', async () => {
    const send = jest.fn().mockRejectedValue(new Error('boom'));
    connect.mockResolvedValue(fakeRcon(send));
    const service = new RconService(makeServers());

    await expect(service.send('srv1', 'list')).rejects.toThrow('boom');
    // Next send reconnects (pool was evicted).
    const send2 = jest.fn().mockResolvedValue('ok');
    connect.mockResolvedValue(fakeRcon(send2));
    await expect(service.send('srv1', 'list')).resolves.toBe('ok');
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
