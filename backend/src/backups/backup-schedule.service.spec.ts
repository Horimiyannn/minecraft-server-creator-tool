import { BadRequestException } from '@nestjs/common';
import { BackupScheduleService } from './backup-schedule.service';

jest.useFakeTimers();

function makeHarness(schedule: Record<string, unknown> = {}) {
  const createBackup = jest.fn().mockResolvedValue({ id: 'b1', sizeBytes: 1n });
  const rconSend = jest
    .fn()
    .mockResolvedValue('There are 0 of a max of 20 players online:');
  const record = {
    serverId: 's1',
    worldEveryMin: 5,
    fullEveryMin: null,
    keepWorld: 3,
    keepFull: 2,
    skipWhenEmpty: true,
    chatEnabled: true,
    ...schedule,
  };
  const seen = { value: false };

  const service = new BackupScheduleService(
    {
      listSchedules: jest.fn().mockResolvedValue([record]),
      getSchedule: jest.fn().mockResolvedValue(record),
      upsertSchedule: jest.fn(async (_id: string, data: unknown) => ({
        serverId: 's1',
        ...(data as object),
      })),
    } as never,
    { create: createBackup } as never,
    { send: rconSend } as never,
    {
      playersSeen: () => seen.value,
      clearPlayersSeen: jest.fn(() => {
        seen.value = false;
      }),
      markPlayersSeen: jest.fn(() => {
        seen.value = true;
      }),
      watch: jest.fn(),
      unwatch: jest.fn(),
    } as never,
  );

  return { service, createBackup, rconSend, seen };
}

describe('BackupScheduleService', () => {
  afterEach(() => jest.clearAllTimers());

  it('skips a tick on an empty server with nothing seen since the last backup', async () => {
    const { service, createBackup } = makeHarness();
    await service.onModuleInit();

    jest.advanceTimersByTime(5 * 60 * 1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(createBackup).not.toHaveBeenCalled();
  });

  it('still backs up an empty server when players were seen since the last backup', async () => {
    const { service, createBackup, seen } = makeHarness();
    await service.onModuleInit();
    seen.value = true;

    jest.advanceTimersByTime(5 * 60 * 1000);
    await flushTimers();

    expect(createBackup).toHaveBeenCalledWith('s1', 'world', 'schedule');
  });

  it('backs up when players are online regardless of the seen flag', async () => {
    const { service, createBackup, rconSend } = makeHarness();
    rconSend.mockResolvedValue(
      'There are 2 of a max of 20 players online: A, B',
    );
    await service.onModuleInit();

    jest.advanceTimersByTime(5 * 60 * 1000);
    await flushTimers();

    expect(createBackup).toHaveBeenCalled();
  });

  it('rejects an interval below the 5 minute floor', async () => {
    const { service } = makeHarness();
    await expect(
      service.save('s1', {
        worldEveryMin: 2,
        fullEveryMin: null,
        keepWorld: 3,
        keepFull: 2,
        skipWhenEmpty: true,
        chatEnabled: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a keep count above 20', async () => {
    const { service } = makeHarness();
    await expect(
      service.save('s1', {
        worldEveryMin: null,
        fullEveryMin: null,
        keepWorld: 50,
        keepFull: 2,
        skipWhenEmpty: true,
        chatEnabled: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

async function flushTimers(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}
