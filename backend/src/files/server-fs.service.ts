import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createReadStream as fsCreateReadStream,
  constants as fsConstants,
} from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import * as path from 'node:path';
import { dataDir } from '../servers/paths';
import { PathError, resolveInRoot } from './path';

export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  sizeBytes: number;
  mtimeMs: number;
}

/** How deep `search` walks before giving up on a branch. */
const SEARCH_MAX_DEPTH = 12;
/** Directories never worth walking for a filename search. */
const SEARCH_SKIP = new Set(['libraries', 'cache', 'logs', '.git']);

@Injectable()
export class ServerFsService {
  private readonly dataRoot: string;

  constructor(configService: ConfigService) {
    this.dataRoot = configService.get<string>('MC_DATA_ROOT') ?? '/srv/mc';
  }

  root(serverId: string): string {
    return dataDir(this.dataRoot, serverId);
  }

  /**
   * Guard the textual path, then confirm the nearest existing ancestor's
   * realpath is still inside the root — a symlink inside data/ pointing at
   * /etc passes the textual check but must not be readable.
   */
  async resolve(serverId: string, rel: string): Promise<string> {
    const root = this.root(serverId);
    const resolved = resolveInRoot(root, rel);
    const realRoot = await realpath(root);
    let probe = resolved;
    for (;;) {
      try {
        await access(probe, fsConstants.F_OK);
        break;
      } catch {
        const parent = path.dirname(probe);
        if (parent === probe) return resolved; // nothing exists yet — textual check stands
        probe = parent;
      }
    }
    const real = await realpath(probe);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new PathError(`path escapes the server directory: ${rel}`);
    }
    return resolved;
  }

  async list(serverId: string, rel: string): Promise<FileEntry[]> {
    const dir = await this.resolve(serverId, rel);
    const dirents = await readdir(dir, { withFileTypes: true });
    const entries = await Promise.all(
      dirents.map(async (dirent) => {
        const info = await stat(path.join(dir, dirent.name)).catch(() => null);
        return {
          name: dirent.name,
          type: dirent.isDirectory() ? ('dir' as const) : ('file' as const),
          sizeBytes: info?.size ?? 0,
          mtimeMs: info?.mtimeMs ?? 0,
        };
      }),
    );
    // Directories first, then case-insensitive by name — the order a file
    // manager is expected to show.
    return entries.sort(
      (a, b) =>
        Number(b.type === 'dir') - Number(a.type === 'dir') ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
  }

  async stat(serverId: string, rel: string): Promise<FileEntry> {
    const target = await this.resolve(serverId, rel);
    const info = await stat(target);
    return {
      name: path.basename(target),
      type: info.isDirectory() ? 'dir' : 'file',
      sizeBytes: info.size,
      mtimeMs: info.mtimeMs,
    };
  }

  async readText(
    serverId: string,
    rel: string,
    maxBytes: number,
  ): Promise<{ content: string; mtimeMs: number }> {
    const target = await this.resolve(serverId, rel);
    const info = await stat(target);
    if (info.size > maxBytes) {
      throw new Error(`file is too large to edit (${info.size} bytes)`);
    }
    return { content: await readFile(target, 'utf8'), mtimeMs: info.mtimeMs };
  }

  /** Write via a sibling temp file + rename, so a crash never truncates. */
  async writeText(
    serverId: string,
    rel: string,
    content: string,
  ): Promise<number> {
    const target = await this.resolve(serverId, rel);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${randomBytes(6).toString('hex')}`;
    try {
      await writeFile(tmp, content, 'utf8');
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    return (await stat(target)).mtimeMs;
  }

  async mkdir(serverId: string, rel: string): Promise<void> {
    await mkdir(await this.resolve(serverId, rel), { recursive: true });
  }

  async rename(serverId: string, from: string, to: string): Promise<void> {
    const src = await this.resolve(serverId, from);
    const dest = await this.resolve(serverId, to);
    await mkdir(path.dirname(dest), { recursive: true });
    await rename(src, dest);
  }

  async remove(serverId: string, rel: string): Promise<void> {
    const target = await this.resolve(serverId, rel);
    if (target === this.root(serverId)) {
      throw new PathError('refusing to remove the server data directory');
    }
    await rm(target, { recursive: true, force: true });
  }

  async search(
    serverId: string,
    query: string,
    limit: number,
  ): Promise<string[]> {
    const root = this.root(serverId);
    const needle = query.toLowerCase();
    const hits: string[] = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (hits.length >= limit || depth > SEARCH_MAX_DEPTH) return;
      const dirents = await readdir(dir, { withFileTypes: true }).catch(
        () => [],
      );
      for (const dirent of dirents) {
        if (hits.length >= limit) return;
        const abs = path.join(dir, dirent.name);
        if (dirent.name.toLowerCase().includes(needle)) {
          hits.push(path.relative(root, abs));
        }
        if (dirent.isDirectory() && !SEARCH_SKIP.has(dirent.name)) {
          await walk(abs, depth + 1);
        }
      }
    };

    await walk(root, 0);
    return hits.slice(0, limit);
  }

  async createReadStream(serverId: string, rel: string): Promise<Readable> {
    return fsCreateReadStream(await this.resolve(serverId, rel));
  }

  /**
   * Move a file from outside the root (an upload's temp file) into place.
   * The temp dir is often a different mount, so a cross-device rename falls
   * back to copy + delete.
   */
  async importFile(
    serverId: string,
    rel: string,
    srcPath: string,
  ): Promise<void> {
    const target = await this.resolve(serverId, rel);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await rename(srcPath, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyFile(srcPath, target);
      await rm(srcPath, { force: true });
    }
  }
}
