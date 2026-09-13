import { Injectable } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import * as path from 'node:path';
import archiver from 'archiver';
import * as yauzl from 'yauzl';
import { PathError, resolveInRoot } from './path';

/** Caps that make a zip bomb fail fast instead of filling the disk. */
export const MAX_ZIP_ENTRIES = 10_000;
export const MAX_ZIP_BYTES = 2 * 1024 ** 3;

@Injectable()
export class ArchiveService {
  /**
   * Extract into `destDir`. Every entry name is re-run through the same
   * traversal guard the REST layer uses — an archive is untrusted input, and
   * "../" inside an entry name is the classic zip-slip write-anywhere bug.
   */
  async extractZip(zipPath: string, destDir: string): Promise<void> {
    await mkdir(destDir, { recursive: true });
    const zipFile = await open(zipPath);
    let entries = 0;
    let bytes = 0;

    return new Promise<void>((resolve, reject) => {
      const fail = (error: unknown): void => {
        zipFile.close();
        reject(error as Error);
      };

      zipFile.on('entry', (entry: yauzl.Entry) => {
        entries += 1;
        bytes += entry.uncompressedSize;
        if (entries > MAX_ZIP_ENTRIES || bytes > MAX_ZIP_BYTES) {
          fail(new PathError('archive exceeds the extraction limits'));
          return;
        }
        let target: string;
        try {
          target = resolveInRoot(destDir, entry.fileName);
        } catch (error) {
          fail(error);
          return;
        }
        if (entry.fileName.endsWith('/')) {
          void mkdir(target, { recursive: true }).then(
            () => zipFile.readEntry(),
            fail,
          );
          return;
        }
        zipFile.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail(error ?? new Error('no stream'));
          void mkdir(path.dirname(target), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(target)))
            .then(() => zipFile.readEntry(), fail);
        });
      });
      zipFile.on('end', () => resolve());
      zipFile.on('error', (error: Error) => fail(asArchiveError(error)));
      zipFile.readEntry();
    });
  }

  /** Zip `relPaths` (files or directories) relative to `baseDir`. */
  async createZip(
    baseDir: string,
    relPaths: string[],
    destZip: string,
  ): Promise<void> {
    // Files and directories need different archiver calls (a glob rooted at a
    // file fails with ENOTDIR), so stat everything before building.
    const sources = await Promise.all(
      relPaths.map(async (rel) => {
        const abs = resolveInRoot(baseDir, rel);
        return { rel, abs, isDir: (await stat(abs)).isDirectory() };
      }),
    );
    return this.write(destZip, (archive) => {
      for (const source of sources) {
        if (source.isDir) archive.directory(source.abs, source.rel);
        else archive.file(source.abs, { name: source.rel });
      }
    });
  }

  private write(
    destZip: string,
    add: (archive: archiver.Archiver) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const out = createWriteStream(destZip);
      const archive = archiver('zip', { zlib: { level: 6 } });
      out.on('close', () => resolve());
      archive.on('warning', (error) => {
        if ((error as { code?: string }).code !== 'ENOENT') reject(error);
      });
      archive.on('error', reject);
      archive.pipe(out);
      try {
        add(archive);
      } catch (error) {
        reject(error);
        return;
      }
      void archive.finalize();
    });
  }
}

function open(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile)
        reject(
          error ? asArchiveError(error) : new Error('cannot open archive'),
        );
      else resolve(zipFile);
    });
  });
}

/**
 * yauzl reports malformed archives — including its own rejection of "../" and
 * absolute entry names — as plain Errors. Those are bad input, not server
 * faults, so they surface as PathError (a 400); real IO errors keep their
 * errno code and pass through untouched.
 */
function asArchiveError(error: Error): Error {
  if ((error as NodeJS.ErrnoException).code) return error;
  return new PathError(`invalid archive: ${error.message}`);
}
