import { ChatTriggerService } from './chat-trigger.service';

function makeHarness(ops = '[{"name":"Steve"}]') {
  let sink: (line: string) => void = () => undefined;
  const ends: Array<() => void> = [];
  const rconSend = jest.fn().mockResolvedValue('ok');
  const createBackup = jest.fn().mockResolvedValue({ id: 'b1', kind: 'world' });
  // The service ignores commands for a moment after attaching, because the
  // docker stream replays the last 200 lines. Tests drive the clock past it.
  let now = Date.UTC(2026, 9, 10, 12, 0, 0);
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const subscribe = jest.fn(
    async (_id: string, onLine: (l: string) => void, onEnd?: () => void) => {
      sink = onLine;
      if (onEnd) ends.push(onEnd);
      return () => undefined;
    },
  );

  const chatTriggerService = new ChatTriggerService(
    { subscribe } as never,
    { send: rconSend } as never,
    { create: createBackup } as never,
    {
      getSchedule: jest
        .fn()
        .mockResolvedValue({ chatEnabled: true, skipWhenEmpty: true }),
      listSchedules: jest.fn().mockResolvedValue([]),
    } as never,
    { dataDir: () => '/srv/mc/s1/data' } as never,
  );

  // ops.json is read per command; stub the read the service uses.
  (
    chatTriggerService as unknown as { readOps: () => Promise<string[]> }
  ).readOps = async () =>
    (JSON.parse(ops) as { name: string }[]).map((o) => o.name);

  return {
    chatTriggerService,
    /** Past the replay window, the way a live line arrives. */
    feed: (line: string) => {
      now += 5_000;
      sink(line);
    },
    /** Inside the replay window, the way a tail:200 line arrives. */
    feedReplayed: (line: string) => sink(line),
    endStream: () => ends.forEach((end) => end()),
    subscribe,
    rconSend,
    createBackup,
  };
}

const OP_LINE = '[10:31:02] [Server thread/INFO]: <Steve> !backup';
const NON_OP_LINE = '[10:31:02] [Server thread/INFO]: <Mallory> !backup';

describe('ChatTriggerService', () => {
  it('takes a world backup for an op and replies over RCON', async () => {
    const { chatTriggerService, feed, createBackup, rconSend } = makeHarness();
    await chatTriggerService.watch('s1');

    feed(OP_LINE);
    await flush();

    expect(createBackup).toHaveBeenCalledWith('s1', 'world', 'chat', undefined);
    expect(rconSend.mock.calls[0][1]).toContain('tellraw Steve');
  });

  it('refuses a non-op without touching the backup engine', async () => {
    const { chatTriggerService, feed, createBackup, rconSend } = makeHarness();
    await chatTriggerService.watch('s1');

    feed(NON_OP_LINE);
    await flush();

    expect(createBackup).not.toHaveBeenCalled();
    expect(rconSend.mock.calls[0][1]).toMatch(/tellraw Mallory/);
  });

  it('passes a label through', async () => {
    const { chatTriggerService, feed, createBackup } = makeHarness();
    await chatTriggerService.watch('s1');

    feed('[10:31:02] [Server thread/INFO]: <Steve> !backup before raid');
    await flush();

    expect(createBackup).toHaveBeenCalledWith(
      's1',
      'world',
      'chat',
      'before raid',
    );
  });

  it('rate-limits repeat commands from the same player', async () => {
    const { chatTriggerService, feed, createBackup, rconSend } = makeHarness();
    await chatTriggerService.watch('s1');

    feed(OP_LINE);
    await flush();
    feed(OP_LINE);
    await flush();

    expect(createBackup).toHaveBeenCalledTimes(1);
    expect(rconSend.mock.calls.at(-1)?.[1]).toMatch(/wait/i);
  });

  it('ignores every command other than !backup', async () => {
    const { chatTriggerService, feed, createBackup } = makeHarness();
    await chatTriggerService.watch('s1');

    feed('[10:31:02] [Server thread/INFO]: <Steve> !restore b1');
    feed('[10:31:02] [Server thread/INFO]: <Steve> !backups');
    await flush();

    expect(createBackup).not.toHaveBeenCalled();
  });

  it('marks players as seen when someone joins', async () => {
    const { chatTriggerService, feed } = makeHarness();
    await chatTriggerService.watch('s1');

    expect(chatTriggerService.playersSeen('s1')).toBe(false);
    feed('[10:31:02] [Server thread/INFO]: Steve joined the game');
    expect(chatTriggerService.playersSeen('s1')).toBe(true);
  });

  it('ignores commands replayed from the log tail at attach time', async () => {
    const { chatTriggerService, feedReplayed, createBackup } = makeHarness();
    await chatTriggerService.watch('s1');

    feedReplayed(OP_LINE);
    await flush();

    expect(createBackup).not.toHaveBeenCalled();
  });

  it('re-attaches after the container stops and its log stream ends', async () => {
    const { chatTriggerService, endStream, subscribe, feed, createBackup } =
      makeHarness();
    await chatTriggerService.watch('s1');

    endStream();
    await chatTriggerService.watch('s1');
    expect(subscribe).toHaveBeenCalledTimes(2);

    feed(OP_LINE);
    await flush();
    expect(createBackup).toHaveBeenCalledTimes(1);
  });

  it('attaches once when two callers watch at the same time', async () => {
    const { chatTriggerService, subscribe } = makeHarness();

    await Promise.all([
      chatTriggerService.watch('s1'),
      chatTriggerService.watch('s1'),
    ]);

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('throttles refusals so a non-op cannot flood RCON', async () => {
    const { chatTriggerService, feed, rconSend } = makeHarness();
    await chatTriggerService.watch('s1');

    feed(NON_OP_LINE);
    await flush();
    feed(NON_OP_LINE);
    await flush();

    expect(rconSend).toHaveBeenCalledTimes(1);
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
