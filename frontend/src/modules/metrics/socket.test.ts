import type { ServerStats } from '@/types';

jest.mock('@/lib/socket');

interface FakeSocket {
  on: jest.Mock;
  emit: jest.Mock;
  disconnect: jest.Mock;
}

const GRACE_MS = 10_000;

function fire(socket: FakeSocket, event: string, payload?: unknown): void {
  for (const [name, handler] of socket.on.mock.calls) {
    if (name === event) (handler as (p?: unknown) => void)(payload);
  }
}

function emitted(socket: FakeSocket, event: string): unknown[] {
  return socket.emit.mock.calls
    .filter(([name]) => name === event)
    .map(([, payload]) => payload);
}

// The module keeps process-wide socket state, so each test gets a fresh copy.
function load(): {
  subscribeStats: typeof import('./socket').subscribeStats;
  sockets: FakeSocket[];
  makeSocket: jest.Mock;
} {
  jest.resetModules();
  const sockets: FakeSocket[] = [];
  const lib = require('@/lib/socket') as { makeSocket: jest.Mock };
  lib.makeSocket.mockReset();
  lib.makeSocket.mockImplementation(() => {
    const socket: FakeSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    sockets.push(socket);
    return socket;
  });
  const mod = require('./socket') as typeof import('./socket');
  return {
    subscribeStats: mod.subscribeStats,
    sockets,
    makeSocket: lib.makeSocket,
  };
}

const sample = (serverId: string): ServerStats => ({
  serverId,
  cpuPct: 10,
  memUsedMb: 100,
  memLimitMb: 2048,
  diskMb: 5,
});

describe('subscribeStats', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens one socket and joins the room once for concurrent listeners', () => {
    const { subscribeStats, sockets, makeSocket } = load();
    subscribeStats('s1', jest.fn());
    subscribeStats('s1', jest.fn());
    expect(makeSocket).toHaveBeenCalledTimes(1);
    expect(emitted(sockets[0], 'join')).toEqual([{ serverId: 's1' }]);
  });

  it('routes each stats payload to that server listeners only', () => {
    const { subscribeStats, sockets } = load();
    const one = jest.fn();
    const two = jest.fn();
    subscribeStats('s1', one);
    subscribeStats('s2', two);

    fire(sockets[0], 'stats', sample('s1'));
    expect(one).toHaveBeenCalledWith(sample('s1'));
    expect(two).not.toHaveBeenCalled();
  });

  // The bug this fixes: switching to the Settings tab unmounted MetricsTab,
  // which tore the socket down and forced a full reconnect on the way back.
  it('keeps the socket open through a brief unmount/remount', () => {
    const { subscribeStats, sockets, makeSocket } = load();
    const stop = subscribeStats('s1', jest.fn());

    stop();
    expect(sockets[0].disconnect).not.toHaveBeenCalled();
    expect(emitted(sockets[0], 'leave')).toEqual([]);

    jest.advanceTimersByTime(GRACE_MS - 1);
    subscribeStats('s1', jest.fn());
    jest.advanceTimersByTime(GRACE_MS * 2);

    expect(makeSocket).toHaveBeenCalledTimes(1);
    expect(sockets[0].disconnect).not.toHaveBeenCalled();
    expect(emitted(sockets[0], 'leave')).toEqual([]);
    // Still in the room from the first join — no redundant re-join.
    expect(emitted(sockets[0], 'join')).toEqual([{ serverId: 's1' }]);
  });

  it('delivers stats again after a remount inside the grace window', () => {
    const { subscribeStats, sockets } = load();
    subscribeStats('s1', jest.fn())();
    const afterRemount = jest.fn();
    subscribeStats('s1', afterRemount);

    fire(sockets[0], 'stats', sample('s1'));
    expect(afterRemount).toHaveBeenCalledWith(sample('s1'));
  });

  it('leaves the room and disconnects once the grace window expires', () => {
    const { subscribeStats, sockets } = load();
    const stop = subscribeStats('s1', jest.fn());
    stop();

    jest.advanceTimersByTime(GRACE_MS);
    expect(emitted(sockets[0], 'leave')).toEqual([{ serverId: 's1' }]);
    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the socket alive when only one of two rooms goes idle', () => {
    const { subscribeStats, sockets } = load();
    const stopOne = subscribeStats('s1', jest.fn());
    subscribeStats('s2', jest.fn());

    stopOne();
    jest.advanceTimersByTime(GRACE_MS * 2);
    expect(emitted(sockets[0], 'leave')).toEqual([{ serverId: 's1' }]);
    expect(sockets[0].disconnect).not.toHaveBeenCalled();
  });

  it('opens a fresh socket for a subscribe after a full teardown', () => {
    const { subscribeStats, makeSocket } = load();
    subscribeStats('s1', jest.fn())();
    jest.advanceTimersByTime(GRACE_MS);

    subscribeStats('s1', jest.fn());
    expect(makeSocket).toHaveBeenCalledTimes(2);
  });

  it('re-joins active rooms after a reconnect', () => {
    const { subscribeStats, sockets } = load();
    subscribeStats('s1', jest.fn());
    subscribeStats('s2', jest.fn());
    sockets[0].emit.mockClear();

    fire(sockets[0], 'connect');
    expect(emitted(sockets[0], 'join')).toEqual([
      { serverId: 's1' },
      { serverId: 's2' },
    ]);
  });

  it('is safe to call the same unsubscribe twice', () => {
    const { subscribeStats, sockets } = load();
    const stop = subscribeStats('s1', jest.fn());
    subscribeStats('s1', jest.fn());
    stop();
    stop();
    jest.advanceTimersByTime(GRACE_MS * 2);
    // The second listener is still active, so nothing may be torn down.
    expect(emitted(sockets[0], 'leave')).toEqual([]);
    expect(sockets[0].disconnect).not.toHaveBeenCalled();
  });
});
