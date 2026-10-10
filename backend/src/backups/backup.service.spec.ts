import { ConflictException, NotFoundException } from '@nestjs/common';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BackupService } from './backup.service';
import type { CreateTarOptions } from './tar.service';

interface Harness {
  backupService: BackupService;
  rconSend: jest.Mock;
  tarCreate: jest.Mock;
  created: unknown[];
  deleted: string[];
  serverRoot: () => string;
}

function makeHarness(
  overrides: Record<string, unknown> = {},
  serversOverrides: Record<string, unknown> = {},
): Harness {
  const created: unknown[] = [];
  const deleted: string[] = [];
  const rconSend = jest.fn().mockResolvedValue('ok');
  // The service stats the archive it asked for, so a stubbed tar still has
  // to leave a file behind.
  const serverRoot = mkdtempSync(path.join(tmpdir(), 'mcbackup-'));
  mkdirSync(path.join(serverRoot, 'data'));
  const tarCreate = jest.fn(async (opts: CreateTarOptions) => {
    writeFileSync(opts.dest, 'ARCHIVE');
  });

  const backupRepository = {
    create: jest.fn(async (data: unknown) => {
      created.push(data);
      return { id: `b${created.length}`, ...(data as object) };
    }),
    listByKindOldestFirst: jest.fn().mockResolvedValue([]),
    delete: jest.fn(async (id: string) => {
      deleted.push(id);
    }),
    getSchedule: jest.fn().mockResolvedValue({
      serverId: 's1',
      worldEveryMin: null,
      fullEveryMin: null,
      keepWorld: 2,
      keepFull: 2,
      skipWhenEmpty: true,
      chatEnabled: true,
    }),
    ...overrides,
  };

  const backupService = new BackupService(
    backupRepository as never,
    { create: tarCreate, extract: jest.fn() } as never,
    {
      assertServerExists: jest.fn().mockResolvedValue(undefined),
      resolveContainerId: jest.fn().mockResolvedValue('c1'),
      getServer: jest.fn().mockResolvedValue({ id: 's1', status: 'running' }),
      ...serversOverrides,
    } as never,
    {
      dataDir: () => path.join(serverRoot, 'data'),
      serverRoot: () => serverRoot,
      inspect: jest
        .fn()
        .mockResolvedValue({ running: true, status: 'running' }),
    } as never,
    { send: rconSend } as never,
  );
  return {
    backupService,
    rconSend,
    tarCreate,
    created,
    deleted,
    serverRoot: () => serverRoot,
  };
}

describe('BackupService.create', () => {
  it('brackets the archive with save-off and save-all flush', async () => {
    const { backupService, rconSend } = makeHarness();
    await backupService.create('s1', 'full', 'manual');
    expect(rconSend.mock.calls.map((c) => c[1])).toEqual([
      'save-off',
      'save-all flush',
      'save-on',
    ]);
  });

  it('re-enables saving even when tar fails', async () => {
    const { backupService, rconSend, tarCreate } = makeHarness();
    tarCreate.mockRejectedValue(new Error('disk full'));

    await expect(backupService.create('s1', 'full', 'manual')).rejects.toThrow(
      'disk full',
    );
    expect(rconSend.mock.calls.map((c) => c[1])).toContain('save-on');
  });

  it('refuses a second concurrent backup for the same server', async () => {
    const { backupService, tarCreate } = makeHarness();
    let release: () => void = () => undefined;
    tarCreate.mockImplementation(
      (opts: CreateTarOptions) =>
        new Promise<void>((resolve) => {
          release = () => {
            writeFileSync(opts.dest, 'ARCHIVE');
            resolve();
          };
        }),
    );

    const first = backupService.create('s1', 'full', 'manual');
    await expect(
      backupService.create('s1', 'world', 'chat'),
    ).rejects.toBeInstanceOf(ConflictException);
    // The lock is held across the save-all flush settle, so tar is only
    // reached a moment later; releasing earlier would hang the first call.
    while (tarCreate.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    release();
    await first;
  });

  it('prunes the oldest archives beyond keep-N for that kind only', async () => {
    const stale = path.join(tmpdir(), 'mcbackup-pruned');
    const { backupService, deleted } = makeHarness({
      // Retention runs after the insert, so the list already holds the new row.
      listByKindOldestFirst: jest.fn().mockResolvedValue([
        { id: 'old1', path: path.join(stale, 'a.tar.zst') },
        { id: 'old2', path: path.join(stale, 'b.tar.zst') },
        { id: 'old3', path: path.join(stale, 'c.tar.zst') },
        { id: 'b1', path: path.join(stale, 'new.tar.zst') },
      ]),
    });

    await backupService.create('s1', 'full', 'manual');

    // keepFull is 2 and the new row makes 4 — the two oldest go.
    expect(deleted).toEqual(['old1', 'old2']);
  });

  it('skips RCON entirely when the container is not running', async () => {
    const { backupService, rconSend } = makeHarness();
    (
      backupService as unknown as {
        dockerService: { inspect: jest.Mock };
      }
    ).dockerService.inspect.mockResolvedValue({
      running: false,
      status: 'exited',
    });

    await backupService.create('s1', 'full', 'manual');

    expect(rconSend).not.toHaveBeenCalled();
  });

  it('re-enables saving when the save-off call itself fails mid-flight', async () => {
    // RconService rejects after the server already ran the command (read
    // timeout, dropped reply) — saves would stay off forever.
    const { backupService, rconSend } = makeHarness();
    rconSend.mockRejectedValueOnce(new Error('rcon timeout'));

    await expect(backupService.create('s1', 'full', 'manual')).rejects.toThrow(
      'rcon timeout',
    );

    expect(rconSend.mock.calls.map((c) => c[1])).toContain('save-on');
  });

  it('re-enables saving for an in-flight backup when the panel shuts down', async () => {
    const { backupService, rconSend, tarCreate } = makeHarness();
    let release: () => void = () => undefined;
    tarCreate.mockImplementation(
      (opts: CreateTarOptions) =>
        new Promise<void>((resolve) => {
          release = () => {
            writeFileSync(opts.dest, 'ARCHIVE');
            resolve();
          };
        }),
    );

    const inFlight = backupService.create('s1', 'full', 'manual');
    while (tarCreate.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await backupService.onApplicationShutdown();

    expect(rconSend.mock.calls.map((c) => c[1])).toContain('save-on');
    release();
    await inFlight;
  });
});

describe('BackupService.pathFor', () => {
  it('404s when the row outlived its archive', async () => {
    const { backupService } = makeHarness({
      findById: jest.fn().mockResolvedValue({
        id: 'b1',
        serverId: 's1',
        kind: 'full',
        path: path.join(tmpdir(), 'mcbackup-gone', 'gone.tar.zst'),
      }),
    });

    await expect(backupService.pathFor('s1', 'b1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('BackupService.list', () => {
  it('rejects an unknown server instead of answering with an empty list', async () => {
    const assertServerExists = jest
      .fn()
      .mockRejectedValue(new NotFoundException('Server "nope" not found'));
    const { backupService } = makeHarness({}, { assertServerExists });

    await expect(backupService.list('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
