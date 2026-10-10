import { ChatTriggerService } from './chat-trigger.service';

function makeHarness(ops = '[{"name":"Steve"}]') {
  let sink: (line: string) => void = () => undefined;
  const rconSend = jest.fn().mockResolvedValue('ok');
  const createBackup = jest.fn().mockResolvedValue({ id: 'b1', kind: 'world' });

  const chatTriggerService = new ChatTriggerService(
    {
      subscribe: jest.fn(async (_id: string, onLine: (l: string) => void) => {
        sink = onLine;
        return () => undefined;
      }),
    } as never,
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
    feed: (line: string) => sink(line),
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
});

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
