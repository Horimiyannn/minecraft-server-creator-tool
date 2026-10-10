import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';

export interface CreateTarOptions {
  cwd: string;
  paths: string[];
  excludes?: string[];
  dest: string;
}

export interface ExtractTarOptions {
  archive: string;
  dest: string;
}

/**
 * The only place this codebase shells out. GNU tar (1.35 on the host) with
 * --zstd is used rather than a JS tar because it preserves permissions and
 * symlinks correctly and compresses world data several times faster than
 * gzip — a 3 GB modded world is the normal case, not the edge case.
 */
@Injectable()
export class TarService {
  create(opts: CreateTarOptions): Promise<void> {
    const args = [
      '--zstd',
      ...(opts.excludes ?? []).map((pattern) => `--exclude=${pattern}`),
      '-cf',
      opts.dest,
      '-C',
      opts.cwd,
      ...opts.paths,
    ];
    return run('tar', args);
  }

  extract(opts: ExtractTarOptions): Promise<void> {
    return run('tar', ['--zstd', '-xf', opts.archive, '-C', opts.dest]);
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)),
    );
  });
}
