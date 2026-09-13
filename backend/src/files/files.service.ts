import {
  BadRequestException,
  ConflictException,
  Injectable,
  PayloadTooLargeException,
  StreamableFile,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ArchiveService } from './archive.service';
import { FileEntry, ServerFsService } from './server-fs.service';
import { ServersService } from '../servers/servers.service';
import { PathError } from './path';

/** Editing cap. Anything larger is a download, not a config file. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_SEARCH_RESULTS = 500;
const DEFAULT_SEARCH_RESULTS = 100;

/** What Multer leaves behind for an upload: a temp file and the client's name. */
export interface UploadedTempFile {
  path: string;
  originalname: string;
}

export interface BulkResult {
  path: string;
  ok: boolean;
  error?: string;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly serverFsService: ServerFsService,
    private readonly archiveService: ArchiveService,
    private readonly serversService: ServersService,
  ) {}

  async list(serverId: string, rel: string): Promise<FileEntry[]> {
    await this.serversService.assertServerExists(serverId);
    return this.guarded(() => this.serverFsService.list(serverId, rel));
  }

  async readText(
    serverId: string,
    rel: string,
  ): Promise<{ content: string; mtimeMs: number }> {
    await this.serversService.assertServerExists(serverId);
    return this.guarded(async () => {
      const info = await this.serverFsService.stat(serverId, rel);
      if (info.type === 'dir')
        throw new BadRequestException('path is a directory');
      if (info.sizeBytes > MAX_TEXT_BYTES) {
        throw new PayloadTooLargeException(
          'file is larger than 2 MB — download it instead',
        );
      }
      const read = await this.serverFsService.readText(
        serverId,
        rel,
        MAX_TEXT_BYTES,
      );
      // A NUL byte in the first chunk is the cheap, reliable binary tell; jars,
      // .dat and region files all trip it, plain configs never do.
      if (read.content.slice(0, 8192).includes('\0')) {
        throw new UnsupportedMediaTypeException(
          'file is binary — download it instead',
        );
      }
      return read;
    });
  }

  async writeText(
    serverId: string,
    rel: string,
    content: string,
    mtimeMs?: number,
  ): Promise<{ mtimeMs: number }> {
    await this.serversService.assertServerExists(serverId);
    return this.guarded(async () => {
      if (mtimeMs !== undefined) {
        const current = await this.serverFsService
          .stat(serverId, rel)
          .catch(() => null);
        if (current && current.mtimeMs !== mtimeMs) {
          throw new ConflictException({
            code: 'FILE_CHANGED',
            message: 'file changed on disk since it was opened',
            mtimeMs: current.mtimeMs,
          });
        }
      }
      return {
        mtimeMs: await this.serverFsService.writeText(serverId, rel, content),
      };
    });
  }

  async mkdir(serverId: string, rel: string): Promise<{ ok: true }> {
    await this.serversService.assertServerExists(serverId);
    await this.guarded(() => this.serverFsService.mkdir(serverId, rel));
    return { ok: true };
  }

  /** New empty file. Unlike a save, it never overwrites what is already there. */
  async createFile(serverId: string, rel: string): Promise<{ ok: true }> {
    await this.serversService.assertServerExists(serverId);
    await this.guarded(async () => {
      try {
        await this.serverFsService.createFile(serverId, rel);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        throw new ConflictException({
          code: 'FILE_EXISTS',
          message: 'a file or folder with that name already exists',
        });
      }
    });
    return { ok: true };
  }

  async rename(
    serverId: string,
    from: string,
    to: string,
  ): Promise<{ ok: true }> {
    await this.serversService.assertServerExists(serverId);
    await this.guarded(() => this.serverFsService.rename(serverId, from, to));
    return { ok: true };
  }

  /**
   * Bulk delete reports every path's outcome rather than aborting on the
   * first failure: selecting ten files and losing nine because the tenth is
   * gone would be worse than useless.
   */
  async removeMany(serverId: string, paths: string[]): Promise<BulkResult[]> {
    await this.serversService.assertServerExists(serverId);
    const results: BulkResult[] = [];
    for (const rel of paths) {
      try {
        await this.serverFsService.remove(serverId, rel);
        results.push({ path: rel, ok: true });
      } catch (error) {
        results.push({ path: rel, ok: false, error: message(error) });
      }
    }
    return results;
  }

  /** `limit` arrives as a raw query string; junk falls back to the default. */
  async search(
    serverId: string,
    query: string,
    limit?: string | number,
  ): Promise<string[]> {
    await this.serversService.assertServerExists(serverId);
    const wanted = Number(limit) || DEFAULT_SEARCH_RESULTS;
    return this.guarded(() =>
      this.serverFsService.search(
        serverId,
        query ?? '',
        Math.min(wanted, MAX_SEARCH_RESULTS),
      ),
    );
  }

  async extract(
    serverId: string,
    rel: string,
    dest: string,
  ): Promise<{ ok: true }> {
    await this.serversService.assertServerExists(serverId);
    await this.guarded(async () => {
      const zip = await this.serverFsService.resolve(serverId, rel);
      const target = await this.serverFsService.resolve(serverId, dest);
      await this.archiveService.extractZip(zip, target);
    });
    return { ok: true };
  }

  async compress(
    serverId: string,
    paths: string[],
    dest: string,
  ): Promise<{ ok: true }> {
    await this.serversService.assertServerExists(serverId);
    await this.guarded(async () => {
      const destPath = await this.serverFsService.resolve(serverId, dest);
      await this.archiveService.createZip(
        this.serverFsService.root(serverId),
        paths,
        destPath,
      );
    });
    return { ok: true };
  }

  /**
   * Multer has already streamed the body to a temp file; this validates the
   * client-supplied name and moves the file into place. The temp file is
   * removed on every failure so rejected uploads don't pile up in tmp.
   */
  async saveUpload(
    serverId: string,
    destDir: string,
    file: UploadedTempFile | undefined,
  ): Promise<{ ok: true }> {
    if (!file) throw new BadRequestException('no file was uploaded');
    try {
      await this.serversService.assertServerExists(serverId);
      const name = file.originalname;
      if (
        !name ||
        name === '.' ||
        name === '..' ||
        name !== path.basename(name) ||
        name.includes('\0')
      ) {
        throw new BadRequestException('invalid upload filename');
      }
      await this.guarded(() =>
        this.serverFsService.importFile(
          serverId,
          path.join(destDir, name),
          file.path,
        ),
      );
      return { ok: true };
    } catch (error) {
      await rm(file.path, { force: true });
      throw error;
    }
  }

  async openDownload(serverId: string, rel: string): Promise<StreamableFile> {
    await this.serversService.assertServerExists(serverId);
    return this.guarded(async () => {
      const info = await this.serverFsService.stat(serverId, rel);
      if (info.type === 'file') {
        return new StreamableFile(
          await this.serverFsService.createReadStream(serverId, rel),
          {
            type: 'application/octet-stream',
            disposition: attachment(info.name),
            length: info.sizeBytes,
          },
        );
      }
      // Directories are zipped into a temp file first: streaming an archive
      // while it is still being built hides errors behind a 200 already sent.
      const zipPath = path.join(
        tmpdir(),
        `mc-dl-${randomBytes(8).toString('hex')}.zip`,
      );
      try {
        await this.archiveService.createZip(
          this.serverFsService.root(serverId),
          [rel],
          zipPath,
        );
      } catch (error) {
        await rm(zipPath, { force: true });
        throw error;
      }
      const stream = createReadStream(zipPath);
      stream.on('close', () => void rm(zipPath, { force: true }));
      return new StreamableFile(stream, {
        type: 'application/zip',
        disposition: attachment(`${info.name}.zip`),
      });
    });
  }

  /** A guard rejection is the client's bad input, never a 500. */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PathError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

/** RFC 6266 form, so non-ASCII filenames survive the header. */
function attachment(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
