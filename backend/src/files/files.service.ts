import {
  BadRequestException,
  ConflictException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ArchiveService } from './archive.service';
import { FileEntry, ServerFsService } from './server-fs.service';
import { ServersService } from '../servers/servers.service';

/** Editing cap. Anything larger is a download, not a config file. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_SEARCH_RESULTS = 500;

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
    return this.serverFsService.list(serverId, rel);
  }

  async readText(
    serverId: string,
    rel: string,
  ): Promise<{ content: string; mtimeMs: number }> {
    await this.serversService.assertServerExists(serverId);
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
  }

  async writeText(
    serverId: string,
    rel: string,
    content: string,
    mtimeMs?: number,
  ): Promise<{ mtimeMs: number }> {
    await this.serversService.assertServerExists(serverId);
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
  }

  async mkdir(serverId: string, rel: string): Promise<void> {
    await this.serversService.assertServerExists(serverId);
    await this.serverFsService.mkdir(serverId, rel);
  }

  async rename(serverId: string, from: string, to: string): Promise<void> {
    await this.serversService.assertServerExists(serverId);
    await this.serverFsService.rename(serverId, from, to);
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

  async search(
    serverId: string,
    query: string,
    limit: number,
  ): Promise<string[]> {
    await this.serversService.assertServerExists(serverId);
    return this.serverFsService.search(
      serverId,
      query,
      Math.min(limit, MAX_SEARCH_RESULTS),
    );
  }

  async extract(serverId: string, rel: string, dest: string): Promise<void> {
    await this.serversService.assertServerExists(serverId);
    const zip = await this.serverFsService.resolve(serverId, rel);
    const target = await this.serverFsService.resolve(serverId, dest);
    await this.archiveService.extractZip(zip, target);
  }

  async compress(
    serverId: string,
    paths: string[],
    dest: string,
  ): Promise<void> {
    await this.serversService.assertServerExists(serverId);
    const destPath = await this.serverFsService.resolve(serverId, dest);
    await this.archiveService.createZip(
      this.serverFsService.root(serverId),
      paths,
      destPath,
    );
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
