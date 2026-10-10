import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { TarService } from './tar.service';

describe('TarService', () => {
  const tarService = new TarService();

  it('round-trips a directory through tar --zstd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mctar-'));
    const src = path.join(root, 'data');
    await mkdir(path.join(src, 'world'), { recursive: true });
    await mkdir(path.join(src, 'logs'), { recursive: true });
    await writeFile(path.join(src, 'world/level.dat'), 'DATA');
    await writeFile(path.join(src, 'logs/latest.log'), 'noise');

    const dest = path.join(root, 'out.tar.zst');
    await tarService.create({
      cwd: src,
      paths: ['.'],
      excludes: ['./logs'],
      dest,
    });

    const restored = path.join(root, 'restored');
    await mkdir(restored);
    await tarService.extract({ archive: dest, dest: restored });

    expect(await readFile(path.join(restored, 'world/level.dat'), 'utf8')).toBe(
      'DATA',
    );
    await expect(
      readFile(path.join(restored, 'logs/latest.log'), 'utf8'),
    ).rejects.toThrow();
  });

  it('rejects with tar stderr when the source is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mctar-'));
    await expect(
      tarService.create({
        cwd: root,
        paths: ['does-not-exist'],
        dest: path.join(root, 'x.tar.zst'),
      }),
    ).rejects.toThrow(/does-not-exist/);
  });

  it('treats a path starting with a dash as a path, not a tar option', async () => {
    // Anything inside the container can create a directory in `data/`, and
    // level-name picks the path we hand to tar.
    const root = await mkdtemp(path.join(tmpdir(), 'mctar-'));
    const src = path.join(root, 'data');
    await mkdir(path.join(src, '--totals'), { recursive: true });
    await writeFile(path.join(src, '--totals/level.dat'), 'DATA');

    const dest = path.join(root, 'out.tar.zst');
    await tarService.create({ cwd: src, paths: ['--totals'], dest });

    const restored = path.join(root, 'restored');
    await mkdir(restored);
    await tarService.extract({ archive: dest, dest: restored });
    expect(
      await readFile(path.join(restored, '--totals/level.dat'), 'utf8'),
    ).toBe('DATA');
  });
});
