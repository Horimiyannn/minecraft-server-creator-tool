import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { FilesService } from './files.service';
import { ServerFsService } from './server-fs.service';
import { ArchiveService } from './archive.service';
import { ServersService } from '../servers/servers.service';
import { PathError } from './path';

function makeService(overrides: Partial<ServerFsService> = {}): {
  filesService: FilesService;
  fs: jest.Mocked<ServerFsService>;
  archiveService: jest.Mocked<ArchiveService>;
} {
  const fs = {
    list: jest.fn(),
    stat: jest.fn(),
    readText: jest.fn(),
    writeText: jest.fn(),
    mkdir: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
    search: jest.fn(),
    root: jest.fn().mockReturnValue('/srv/mc/s1/data'),
    resolve: jest.fn(),
    importFile: jest.fn(),
    createFile: jest.fn(),
    createReadStream: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<ServerFsService>;
  const archiveService = {
    extractZip: jest.fn(),
    createZip: jest.fn(),
  } as unknown as jest.Mocked<ArchiveService>;
  const serversService = {
    assertServerExists: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ServersService>;
  return {
    filesService: new FilesService(fs, archiveService, serversService),
    fs,
    archiveService,
  };
}

describe('FilesService', () => {
  it('rejects a binary file for text editing', async () => {
    const { filesService, fs } = makeService();
    fs.stat.mockResolvedValue({
      name: 'a.jar',
      type: 'file',
      sizeBytes: 10,
      mtimeMs: 1,
    });
    fs.readText.mockResolvedValue({ content: 'ab\0cd', mtimeMs: 1 });
    await expect(filesService.readText('s1', 'a.jar')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it('409s when the file changed on disk since the editor loaded it', async () => {
    const { filesService, fs } = makeService();
    fs.stat.mockResolvedValue({
      name: 'a.txt',
      type: 'file',
      sizeBytes: 3,
      mtimeMs: 200,
    });
    await expect(
      filesService.writeText('s1', 'a.txt', 'new', 100),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fs.writeText).not.toHaveBeenCalled();
  });

  it('writes when the mtime matches, and when none was supplied', async () => {
    const { filesService, fs } = makeService();
    fs.stat.mockResolvedValue({
      name: 'a.txt',
      type: 'file',
      sizeBytes: 3,
      mtimeMs: 100,
    });
    fs.writeText.mockResolvedValue(300);

    await expect(
      filesService.writeText('s1', 'a.txt', 'new', 100),
    ).resolves.toEqual({ mtimeMs: 300 });
    await expect(filesService.writeText('s1', 'a.txt', 'new')).resolves.toEqual(
      { mtimeMs: 300 },
    );
  });

  it('reports per-path outcomes for a bulk delete instead of aborting', async () => {
    const { filesService, fs } = makeService();
    fs.remove
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new PathError('nope'));

    await expect(
      filesService.removeMany('s1', ['ok.txt', '..']),
    ).resolves.toEqual([
      { path: 'ok.txt', ok: true },
      { path: '..', ok: false, error: 'nope' },
    ]);
  });

  it('checks the server exists before touching the filesystem', async () => {
    const list = jest.fn();
    const serversService = {
      assertServerExists: jest
        .fn()
        .mockRejectedValue(new NotFoundException('gone')),
    } as unknown as ServersService;
    const svc = new FilesService(
      { list } as unknown as ServerFsService,
      {} as ArchiveService,
      serversService,
    );
    await expect(svc.list('missing', '')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('turns a traversal attempt into a 400 instead of a 500', async () => {
    const { filesService, fs } = makeService();
    fs.list.mockRejectedValue(
      new PathError('path escapes the server directory'),
    );
    await expect(filesService.list('s1', '..')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('caps search results and defaults a junk limit', async () => {
    const { filesService, fs } = makeService();
    fs.search.mockResolvedValue([]);
    await filesService.search('s1', 'toml', '9999');
    await filesService.search('s1', 'toml', 'abc');
    expect(fs.search.mock.calls.map((call) => call[2])).toEqual([500, 100]);
  });

  it('moves an upload into the destination directory', async () => {
    const { filesService, fs } = makeService();
    fs.importFile.mockResolvedValue(undefined);

    await expect(
      filesService.saveUpload('s1', 'mods', {
        path: '/tmp/up123',
        originalname: 'cool-mod.jar',
      }),
    ).resolves.toEqual({ ok: true });

    expect(fs.importFile).toHaveBeenCalledWith(
      's1',
      'mods/cool-mod.jar',
      '/tmp/up123',
    );
  });

  it.each(['../evil.jar', 'a/b.jar', '..', ''])(
    'refuses upload filename %p',
    async (originalname) => {
      const { filesService, fs } = makeService();
      await expect(
        filesService.saveUpload('s1', 'mods', {
          path: '/tmp/up123',
          originalname,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fs.importFile).not.toHaveBeenCalled();
    },
  );

  it('400s an upload request that carried no file', async () => {
    const { filesService } = makeService();
    await expect(
      filesService.saveUpload('s1', 'mods', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('zips a directory for download', async () => {
    const { filesService, fs, archiveService } = makeService();
    fs.stat.mockResolvedValue({
      name: 'config',
      type: 'dir',
      sizeBytes: 0,
      mtimeMs: 1,
    });
    archiveService.createZip.mockImplementation(async (_base, _paths, dest) => {
      await writeFile(dest, 'zip');
    });

    const file = await filesService.openDownload('s1', 'config');

    expect(file.getHeaders().disposition).toContain('config.zip');
    file.getStream().resume(); // drain so the temp zip is cleaned up
  });

  it('streams a plain file for download as-is', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcdl-'));
    const onDisk = path.join(dir, 'server.properties');
    await writeFile(onDisk, 'a=1');
    const { createReadStream } =
      jest.requireActual<typeof import('node:fs')>('node:fs');
    const { filesService, fs, archiveService } = makeService();
    fs.stat.mockResolvedValue({
      name: 'server.properties',
      type: 'file',
      sizeBytes: 3,
      mtimeMs: 1,
    });
    fs.createReadStream.mockResolvedValue(createReadStream(onDisk));

    const file = await filesService.openDownload('s1', 'server.properties');

    expect(file.getHeaders().disposition).toContain('server.properties');
    expect(file.getHeaders().length).toBe(3);
    expect(archiveService.createZip).not.toHaveBeenCalled();
    file.getStream().resume();
  });
  it('creates a new empty file', async () => {
    const { filesService, fs } = makeService();
    fs.createFile.mockResolvedValue(undefined);
    await expect(
      filesService.createFile('s1', 'config/new.toml'),
    ).resolves.toEqual({ ok: true });
    expect(fs.createFile).toHaveBeenCalledWith('s1', 'config/new.toml');
  });

  it('409s creating a file whose name is already taken', async () => {
    const { filesService, fs } = makeService();
    fs.createFile.mockRejectedValue(
      Object.assign(new Error('exists'), { code: 'EEXIST' }),
    );
    await expect(
      filesService.createFile('s1', 'eula.txt'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
