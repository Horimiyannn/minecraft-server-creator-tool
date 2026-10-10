import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BackupService } from './backup.service';
import { TarService } from './tar.service';

describe('BackupService.restore', () => {
  async function setup(kind: 'world' | 'full', levelName = 'world') {
    const root = await mkdtemp(path.join(tmpdir(), 'mcrestore-'));
    const dataDir = path.join(root, 's1', 'data');
    const backupsDir = path.join(root, 's1', 'backups');
    await mkdir(path.join(dataDir, levelName), { recursive: true });
    await mkdir(backupsDir, { recursive: true });
    await writeFile(path.join(dataDir, `${levelName}/level.dat`), 'OLD');
    await writeFile(
      path.join(dataDir, 'server.properties'),
      `level-name=${levelName}`,
    );

    // A real archive holding the "good" world.
    const tarService = new TarService();
    const staging = path.join(root, 'staging');
    await mkdir(path.join(staging, 'world'), { recursive: true });
    await writeFile(path.join(staging, 'world/level.dat'), 'GOOD');
    const archive = path.join(backupsDir, `${kind}.tar.zst`);
    await tarService.create({ cwd: staging, paths: ['world'], dest: archive });

    const lifecycle: string[] = [];
    const backupService = new BackupService(
      {
        findById: jest.fn().mockResolvedValue({
          id: 'b1',
          serverId: 's1',
          kind,
          path: archive,
        }),
        getSchedule: jest.fn(),
        listByKindOldestFirst: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        delete: jest.fn(),
      } as never,
      tarService,
      {
        assertServerExists: jest.fn().mockResolvedValue(undefined),
        resolveContainerId: jest.fn().mockResolvedValue('c1'),
        stop: jest.fn(async () => {
          lifecycle.push('stop');
        }),
        start: jest.fn(async () => {
          lifecycle.push('start');
        }),
      } as never,
      {
        dataDir: () => dataDir,
        serverRoot: () => path.join(root, 's1'),
        inspect: jest
          .fn()
          .mockResolvedValue({ running: true, status: 'running' }),
      } as never,
      { send: jest.fn() } as never,
    );

    return { backupService, dataDir, lifecycle, root };
  }

  it('replaces only the world dirs for a world restore', async () => {
    const { backupService, dataDir, lifecycle } = await setup('world');

    await backupService.restore('s1', 'b1');

    expect(await readFile(path.join(dataDir, 'world/level.dat'), 'utf8')).toBe(
      'GOOD',
    );
    // server.properties is outside the world — a world restore must not touch it
    expect(
      await readFile(path.join(dataDir, 'server.properties'), 'utf8'),
    ).toBe('level-name=world');
    expect(lifecycle).toEqual(['stop', 'start']);
  });

  it('swaps the whole data dir for a full restore and clears the old copy', async () => {
    const { backupService, dataDir, root } = await setup('full');

    await backupService.restore('s1', 'b1');

    expect(await readFile(path.join(dataDir, 'world/level.dat'), 'utf8')).toBe(
      'GOOD',
    );
    const left = await readdir(path.join(root, 's1'));
    expect(left.filter((name) => name.startsWith('data.restoring-'))).toEqual(
      [],
    );
  });

  it('rolls the old data dir back when extraction fails', async () => {
    const { backupService, dataDir } = await setup('full');
    jest
      .spyOn(TarService.prototype, 'extract')
      .mockRejectedValueOnce(new Error('corrupt archive'));

    await expect(backupService.restore('s1', 'b1')).rejects.toThrow(
      'corrupt archive',
    );
    expect(await readFile(path.join(dataDir, 'world/level.dat'), 'utf8')).toBe(
      'OLD',
    );
  });

  it('refuses a world restore whose archive does not hold the live level', async () => {
    // level-name was changed to "survival" after this backup was taken; the
    // archive still holds "world/". Deleting the moved-aside survival copy
    // would lose the live world and report success.
    const { backupService, dataDir } = await setup('world', 'survival');

    await expect(backupService.restore('s1', 'b1')).rejects.toThrow(/survival/);

    expect(
      await readFile(path.join(dataDir, 'survival/level.dat'), 'utf8'),
    ).toBe('OLD');
    const left = await readdir(dataDir);
    expect(left.filter((name) => name.includes('.restoring-'))).toEqual([]);
  });

  it('rejects a level-name that is not a safe directory name', async () => {
    const { backupService, dataDir } = await setup('world');
    await writeFile(
      path.join(dataDir, 'server.properties'),
      'level-name=--exclude=*',
    );

    await expect(backupService.restore('s1', 'b1')).rejects.toThrow(
      /level-name/,
    );
  });
});
