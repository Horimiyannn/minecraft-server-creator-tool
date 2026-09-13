import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { crc32 } from 'node:zlib';
import { ArchiveService } from './archive.service';
import { PathError } from './path';

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'mcarc-'));
}

/**
 * A single-entry stored zip with a literal entry name. archiver cannot build
 * a hostile archive — it strips leading "../" from entry names — so the bytes
 * are laid out by hand: local header, data, central directory, end record.
 */
function rawZip(name: string, content: string): Buffer {
  const nameBuf = Buffer.from(name);
  const data = Buffer.from(content);
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBuf.length, 12);
  end.writeUInt32LE(local.length + nameBuf.length + data.length, 16);

  return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}

describe('ArchiveService', () => {
  const archiveService = new ArchiveService();

  it('round-trips a directory through zip', async () => {
    const dir = await tmp();
    await mkdir(path.join(dir, 'src/config'), { recursive: true });
    await writeFile(path.join(dir, 'src/config/a.toml'), 'a=1');
    await writeFile(path.join(dir, 'src/readme.txt'), 'hi');

    const zip = path.join(dir, 'out.zip');
    await archiveService.createZip(
      path.join(dir, 'src'),
      ['config', 'readme.txt'],
      zip,
    );

    const dest = path.join(dir, 'dest');
    await archiveService.extractZip(zip, dest);

    expect(await readFile(path.join(dest, 'config/a.toml'), 'utf8')).toBe(
      'a=1',
    );
    expect(await readFile(path.join(dest, 'readme.txt'), 'utf8')).toBe('hi');
  });

  it('extracts a hand-built archive with a benign entry name', async () => {
    const dir = await tmp();
    const zip = path.join(dir, 'ok.zip');
    await writeFile(zip, rawZip('ok.txt', 'fine'));

    const dest = path.join(dir, 'dest');
    await archiveService.extractZip(zip, dest);

    expect(await readFile(path.join(dest, 'ok.txt'), 'utf8')).toBe('fine');
  });

  it('refuses an entry that escapes the destination (zip slip)', async () => {
    const dir = await tmp();
    const zip = path.join(dir, 'evil.zip');
    await writeFile(zip, rawZip('../escaped.txt', 'pwned'));

    const dest = path.join(dir, 'dest');
    await expect(archiveService.extractZip(zip, dest)).rejects.toThrow(
      PathError,
    );
    await expect(readdir(dir)).resolves.not.toContain('escaped.txt');
  });
});
