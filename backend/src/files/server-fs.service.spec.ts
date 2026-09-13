import { mkdtemp, mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { ServerFsService } from './server-fs.service';
import { PathError } from './path';

const SERVER_ID = 'srv1';

async function makeService(): Promise<{ svc: ServerFsService; data: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'mcfs-'));
  const data = path.join(root, SERVER_ID, 'data');
  await mkdir(data, { recursive: true });
  const configService = {
    get: (key: string) => (key === 'MC_DATA_ROOT' ? root : undefined),
  } as unknown as ConfigService;
  return { svc: new ServerFsService(configService), data };
}

describe('ServerFsService', () => {
  it('lists files and directories with size and mtime', async () => {
    const { svc, data } = await makeService();
    await mkdir(path.join(data, 'mods'));
    await writeFile(path.join(data, 'server.properties'), 'level-name=world\n');

    const entries = await svc.list(SERVER_ID, '');

    expect(entries.map((e) => [e.name, e.type])).toEqual(
      expect.arrayContaining([
        ['mods', 'dir'],
        ['server.properties', 'file'],
      ]),
    );
    const file = entries.find((e) => e.name === 'server.properties')!;
    expect(file.sizeBytes).toBe(17);
    expect(file.mtimeMs).toBeGreaterThan(0);
  });

  it('reads text and reports its mtime', async () => {
    const { svc, data } = await makeService();
    await writeFile(path.join(data, 'a.txt'), 'hello');
    const read = await svc.readText(SERVER_ID, 'a.txt', 1024);
    expect(read.content).toBe('hello');
    expect(read.mtimeMs).toBeGreaterThan(0);
  });

  it('refuses to read a file past the byte cap', async () => {
    const { svc, data } = await makeService();
    await writeFile(path.join(data, 'big.txt'), 'x'.repeat(100));
    await expect(svc.readText(SERVER_ID, 'big.txt', 10)).rejects.toThrow(
      /too large/i,
    );
  });

  it('writes atomically and leaves no temp file behind', async () => {
    const { svc, data } = await makeService();
    await svc.writeText(SERVER_ID, 'config/new.toml', 'a=1');
    expect(await readFile(path.join(data, 'config/new.toml'), 'utf8')).toBe(
      'a=1',
    );
    const leftovers = await svc.list(SERVER_ID, 'config');
    expect(leftovers.map((e) => e.name)).toEqual(['new.toml']);
  });

  it('renames and removes recursively', async () => {
    const { svc, data } = await makeService();
    await mkdir(path.join(data, 'old/inner'), { recursive: true });
    await writeFile(path.join(data, 'old/inner/f.txt'), 'x');

    await svc.rename(SERVER_ID, 'old', 'new');
    expect((await svc.list(SERVER_ID, '')).map((e) => e.name)).toEqual(['new']);

    await svc.remove(SERVER_ID, 'new');
    expect(await svc.list(SERVER_ID, '')).toEqual([]);
  });

  it('refuses to remove the data root itself', async () => {
    const { svc } = await makeService();
    await expect(svc.remove(SERVER_ID, '')).rejects.toThrow(PathError);
  });

  it('rejects a path that escapes via a symlink', async () => {
    const { svc, data } = await makeService();
    await symlink('/etc', path.join(data, 'escape'));
    await expect(
      svc.readText(SERVER_ID, 'escape/passwd', 1024),
    ).rejects.toThrow(PathError);
  });

  it('searches filenames case-insensitively up to the limit', async () => {
    const { svc, data } = await makeService();
    await mkdir(path.join(data, 'config'), { recursive: true });
    await writeFile(path.join(data, 'config/Alpha.toml'), '');
    await writeFile(path.join(data, 'config/beta.toml'), '');

    expect(await svc.search(SERVER_ID, 'alpha', 10)).toEqual([
      'config/Alpha.toml',
    ]);
    expect(await svc.search(SERVER_ID, 'toml', 1)).toHaveLength(1);
  });

  it('imports a file from outside the root into place', async () => {
    const { svc, data } = await makeService();
    const outside = await mkdtemp(path.join(tmpdir(), 'mcup-'));
    const src = path.join(outside, 'upload');
    await writeFile(src, 'jar');

    await svc.importFile(SERVER_ID, 'mods/cool.jar', src);

    expect(await readFile(path.join(data, 'mods/cool.jar'), 'utf8')).toBe(
      'jar',
    );
    await expect(readFile(src)).rejects.toThrow();
  });
  it('creates an empty file, refusing to clobber an existing one', async () => {
    const { svc, data } = await makeService();
    await svc.createFile(SERVER_ID, 'config/new.toml');
    expect(await readFile(path.join(data, 'config/new.toml'), 'utf8')).toBe('');

    await writeFile(path.join(data, 'config/new.toml'), 'keep');
    await expect(
      svc.createFile(SERVER_ID, 'config/new.toml'),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path.join(data, 'config/new.toml'), 'utf8')).toBe(
      'keep',
    );
  });
});
