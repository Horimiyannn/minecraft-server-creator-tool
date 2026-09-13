import {
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
});
