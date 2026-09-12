# File Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every server a browsable, editable file manager over its `data/` directory — list, edit, upload, download, rename, delete, mkdir, search, bulk operations, zip extract and compress — behind one path-safety boundary.

**Architecture:** A new Nest module `backend/src/files/` owns all filesystem access. `path.ts` is a pure resolve-and-guard function (the security core, tested adversarially). `ServerFsService` is the only code that touches `node:fs` for server data, mirroring the role `DockerService` plays for Docker. `ArchiveService` is the only importer of the zip libraries. `FilesService` adds caps, conflict detection and bulk-result shaping; `FilesController` is a thin guarded REST surface. The frontend gains a `files` module and a Files tab.

**Tech Stack:** Nest 11 (CommonJS), TypeScript 5.9, Jest 29 + ts-jest, `yauzl` (zip read), `archiver` (zip write), Multer via `@nestjs/platform-express`; frontend Next 16 App Router, TanStack Query, Jest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-12-files-backups-packs-design.md`

## Global Constraints

- TypeScript **5.9**, Prisma **6.19**, Nest **11**, CommonJS output. **Never** upgrade to TypeScript 7 or Prisma 7.
- pnpm is the package manager (`pnpm@10.28.1`). Add deps with `pnpm --filter ./backend add <pkg>`.
- **Architecture rule (binding):** controller → service → repository. Only repository classes may import `PrismaService`. This plan adds no table, so it adds no repository; `ServerFsService` is the resource-access layer for the filesystem and is the only place `node:fs` is used for server data.
- Inject services as `*Service`-suffixed constructor fields (`private readonly filesService: FilesService`). All logic lives in services; controllers only route.
- Git hooks must not be bypassed. pre-commit runs lint-staged + `pnpm typecheck`; pre-push runs `pnpm build && pnpm test && pnpm test:e2e && pnpm fallow`. Never pass `--no-verify`.
- Commit messages: conventional-commit title only, no body.
- Backend unit tests: `pnpm --filter ./backend test`. A single file: `pnpm --filter ./backend exec jest src/files/path.spec.ts`. Jest `rootDir` is `src`, `testRegex` is `.*\.spec\.ts$`.
- Backend e2e tests: `pnpm --filter ./backend run test:e2e` (files matching `test/*.e2e-spec.ts`).
- Frontend tests: `pnpm --filter ./frontend test`. Playwright: `pnpm --filter ./frontend e2e`.
- Frontend boundaries: a module's internals are private; cross-module imports go through `@/modules/<feature>` (its `index.ts`). Never import `@/modules/*/ui`.
- Env vars are validated in `backend/src/config/env.ts`. New **optional** vars are documented but not added to `REQUIRED_ENV`.

## File Structure

**Created (backend):**

| Path                                     | Responsibility                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `backend/src/servers/paths.ts`           | Pure per-server path layout: `serverRoot`, `dataDir`, `backupsDir`, `stagingDir` |
| `backend/src/files/path.ts`              | Pure traversal guard: `resolveInRoot(root, rel)`                                 |
| `backend/src/files/server-fs.service.ts` | fs primitives against a server's `data/`                                         |
| `backend/src/files/archive.service.ts`   | zip extract (yauzl) + zip create (archiver)                                      |
| `backend/src/files/files.service.ts`     | caps, conflicts, bulk results, orchestration                                     |
| `backend/src/files/files.controller.ts`  | guarded REST routes                                                              |
| `backend/src/files/files.module.ts`      | module wiring                                                                    |
| `backend/src/files/dto/*.dto.ts`         | request validation                                                               |

**Modified (backend):** `src/servers/docker.service.ts` (delegate `dataDir` to `paths.ts`), `src/servers/servers.service.ts` (+`assertServerExists`, data-root removal on delete), `src/app.module.ts` (register `FilesModule`), `backend/AGENTS.md`.

**Created (frontend):** `src/modules/files/{api.ts,hooks.ts,index.ts}`, `src/modules/files/components/{FilesTab,FileTable,Breadcrumb,FileEditor,FileToolbar}.tsx`, `src/ui/{Checkbox,ConfirmDialog}.tsx`.

**Modified (frontend):** `src/types/api.ts`, `src/constants/index.ts`, `src/ui/index.ts`, `src/app/(panel)/servers/[id]/page.tsx`, `e2e/mocks.ts`.

---

### Task 1: Pure path layout + traversal guard

**Files:**

- Create: `backend/src/servers/paths.ts`
- Create: `backend/src/files/path.ts`
- Test: `backend/src/files/path.spec.ts`
- Modify: `backend/src/servers/docker.service.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `serverRoot(dataRoot: string, id: string): string`, `dataDir(dataRoot: string, id: string): string`, `backupsDir(dataRoot: string, id: string): string`, `stagingDir(dataRoot: string, id: string): string`, `resolveInRoot(root: string, rel: string): string` (throws `PathError`), `class PathError extends Error`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/files/path.spec.ts
import { resolveInRoot, PathError } from './path';

const ROOT = '/srv/mc/abc/data';

describe('resolveInRoot', () => {
  it.each([
    ['', ROOT],
    ['.', ROOT],
    ['mods', `${ROOT}/mods`],
    ['/mods', `${ROOT}/mods`], // leading slash is treated as root-relative
    ['mods/../config/a.toml', `${ROOT}/config/a.toml`],
    ['./world/level.dat', `${ROOT}/world/level.dat`],
  ])('resolves %p inside the root', (rel, expected) => {
    expect(resolveInRoot(ROOT, rel)).toBe(expected);
  });

  it.each([
    ['..'],
    ['../../etc/passwd'],
    ['mods/../../..'],
    ['mods/../../other/data'],
    ['\0etc'],
    ['mods/\0/x'],
  ])('rejects %p', (rel) => {
    expect(() => resolveInRoot(ROOT, rel)).toThrow(PathError);
  });

  it('does not treat a sibling directory with a shared prefix as inside', () => {
    expect(() => resolveInRoot('/srv/mc/abc/data', '../data-evil')).toThrow(
      PathError,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./backend exec jest src/files/path.spec.ts`
Expected: FAIL — `Cannot find module './path'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/servers/paths.ts
import * as path from 'node:path';

export function serverRoot(dataRoot: string, id: string): string {
  return path.join(dataRoot, id);
}

export function dataDir(dataRoot: string, id: string): string {
  return path.join(serverRoot(dataRoot, id), 'data');
}

export function backupsDir(dataRoot: string, id: string): string {
  return path.join(serverRoot(dataRoot, id), 'backups');
}

export function stagingDir(dataRoot: string, id: string): string {
  return path.join(serverRoot(dataRoot, id), 'staging');
}
```

```ts
// backend/src/files/path.ts
import * as path from 'node:path';

export class PathError extends Error {}

/**
 * Resolve a user-supplied relative path inside `root`, or throw. Leading
 * slashes are treated as root-relative (the API speaks paths relative to the
 * server's data dir, so "/mods" means "mods"), and the result must be the
 * root itself or below it — a prefix check alone would accept a sibling like
 * "<root>-evil", so the separator is part of the comparison.
 */
export function resolveInRoot(root: string, rel: string): string {
  if (rel.includes('\0')) throw new PathError('path contains a null byte');
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, `.${path.sep}${rel}`);
  if (
    resolved !== normalizedRoot &&
    !resolved.startsWith(normalizedRoot + path.sep)
  ) {
    throw new PathError(`path escapes the server directory: ${rel}`);
  }
  return resolved;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./backend exec jest src/files/path.spec.ts`
Expected: PASS (12 assertions across the three blocks).

- [ ] **Step 5: Delegate `DockerService.dataDir` to the shared layout**

In `backend/src/servers/docker.service.ts`, replace the `path.join` in `dataDir` and in `create` so both use the helper — one definition of the layout, so the backups plan cannot drift from it:

```ts
import { dataDir as dataDirOf } from './paths';
// ...
  async create(opts: CreateContainerOptions): Promise<string> {
    const dir = dataDirOf(this.dataRoot, opts.id);
    await mkdir(dir, { recursive: true });
    // ... unchanged, using `dir` in the Binds entry
  }

  dataDir(id: string): string {
    return dataDirOf(this.dataRoot, id);
  }
```

- [ ] **Step 6: Run the existing docker tests to prove nothing moved**

Run: `pnpm --filter ./backend exec jest src/servers/docker.service.spec.ts`
Expected: PASS, unchanged count.

- [ ] **Step 7: Commit**

```bash
git add backend/src/servers/paths.ts backend/src/files/path.ts backend/src/files/path.spec.ts backend/src/servers/docker.service.ts
git commit -m "feat: add per-server path layout and traversal guard"
```

---

### Task 2: `ServerFsService` — filesystem primitives

**Files:**

- Create: `backend/src/files/server-fs.service.ts`
- Test: `backend/src/files/server-fs.service.spec.ts`

**Interfaces:**

- Consumes: `resolveInRoot`, `PathError` (Task 1); `dataDir` (Task 1); `ConfigService` (`MC_DATA_ROOT`, default `/srv/mc`).
- Produces:
  - `interface FileEntry { name: string; type: 'file' | 'dir'; sizeBytes: number; mtimeMs: number }`
  - `ServerFsService.root(serverId: string): string`
  - `.resolve(serverId: string, rel: string): Promise<string>` — guard + realpath check
  - `.list(serverId, rel): Promise<FileEntry[]>`
  - `.stat(serverId, rel): Promise<FileEntry>`
  - `.readText(serverId, rel, maxBytes: number): Promise<{ content: string; mtimeMs: number }>`
  - `.writeText(serverId, rel, content: string): Promise<number>` (returns new mtimeMs)
  - `.mkdir(serverId, rel): Promise<void>`
  - `.rename(serverId, from, to): Promise<void>`
  - `.remove(serverId, rel): Promise<void>`
  - `.search(serverId, query: string, limit: number): Promise<string[]>`
  - `.createReadStream(serverId, rel): Promise<NodeJS.ReadableStream>`

Tests run against a real temp directory — permissions, symlinks and rename semantics are only real on a real filesystem.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/files/server-fs.service.spec.ts
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
    expect(file.sizeBytes).toBe(16);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./backend exec jest src/files/server-fs.service.spec.ts`
Expected: FAIL — `Cannot find module './server-fs.service'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/files/server-fs.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createReadStream as fsCreateReadStream,
  constants as fsConstants,
} from 'node:fs';
import {
  access,
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

  async createReadStream(
    serverId: string,
    rel: string,
  ): Promise<NodeJS.ReadableStream> {
    return fsCreateReadStream(await this.resolve(serverId, rel));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./backend exec jest src/files/server-fs.service.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/files/server-fs.service.ts backend/src/files/server-fs.service.spec.ts
git commit -m "feat: add server filesystem primitives"
```

---

### Task 3: `ArchiveService` — zip extract and create

**Files:**

- Create: `backend/src/files/archive.service.ts`
- Test: `backend/src/files/archive.service.spec.ts`
- Modify: `backend/package.json` (deps)

**Interfaces:**

- Consumes: `resolveInRoot`, `PathError` (Task 1).
- Produces: `ArchiveService.extractZip(zipPath: string, destDir: string): Promise<void>`, `ArchiveService.createZip(baseDir: string, relPaths: string[], destZip: string): Promise<void>`, constants `MAX_ZIP_ENTRIES = 10_000`, `MAX_ZIP_BYTES = 2 * 1024 ** 3`.

- [ ] **Step 1: Add the dependencies**

```bash
pnpm --filter ./backend add yauzl archiver
pnpm --filter ./backend add -D @types/yauzl @types/archiver
```

- [ ] **Step 2: Write the failing test**

```ts
// backend/src/files/archive.service.spec.ts
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ArchiveService } from './archive.service';
import { PathError } from './path';

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'mcarc-'));
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

  it('refuses an entry that escapes the destination (zip slip)', async () => {
    const dir = await tmp();
    // Build a hostile zip by hand: archiver keeps the literal entry name.
    const src = path.join(dir, 'src');
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, 'evil'), 'pwned');
    const zip = path.join(dir, 'evil.zip');
    await archiveService.createZipWithNames(
      [{ file: path.join(src, 'evil'), name: '../escaped.txt' }],
      zip,
    );

    const dest = path.join(dir, 'dest');
    await expect(archiveService.extractZip(zip, dest)).rejects.toThrow(
      PathError,
    );
    await expect(readdir(dir)).resolves.not.toContain('escaped.txt');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter ./backend exec jest src/files/archive.service.spec.ts`
Expected: FAIL — `Cannot find module './archive.service'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// backend/src/files/archive.service.ts
import { Injectable } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import * as path from 'node:path';
import archiver from 'archiver';
import * as yauzl from 'yauzl';
import { PathError, resolveInRoot } from './path';

/** Caps that make a zip bomb fail fast instead of filling the disk. */
export const MAX_ZIP_ENTRIES = 10_000;
export const MAX_ZIP_BYTES = 2 * 1024 ** 3;

export interface ZipSource {
  file: string;
  name: string;
}

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
      zipFile.on('error', fail);
      zipFile.readEntry();
    });
  }

  /** Zip `relPaths` (files or directories) relative to `baseDir`. */
  createZip(
    baseDir: string,
    relPaths: string[],
    destZip: string,
  ): Promise<void> {
    return this.write(destZip, (archive) => {
      for (const rel of relPaths) {
        const abs = resolveInRoot(baseDir, rel);
        archive.glob('**/*', { cwd: abs, dot: true }, { prefix: rel });
        archive.file(abs, { name: rel }); // no-op for directories
      }
    });
  }

  /** Zip explicit file→entry-name pairs. Used by tests and by exports. */
  createZipWithNames(sources: ZipSource[], destZip: string): Promise<void> {
    return this.write(destZip, (archive) => {
      for (const source of sources) {
        archive.file(source.file, { name: source.name });
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
      if (error || !zipFile) reject(error ?? new Error('cannot open archive'));
      else resolve(zipFile);
    });
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter ./backend exec jest src/files/archive.service.spec.ts`
Expected: PASS, 2 tests. If `createZip`'s directory handling logs an archiver ENOENT warning for a file entry that is a directory, the warning handler above already swallows it.

- [ ] **Step 6: Commit**

```bash
git add backend/src/files/archive.service.ts backend/src/files/archive.service.spec.ts backend/package.json pnpm-lock.yaml
git commit -m "feat: add zip extract and create with slip and bomb guards"
```

---

### Task 4: `FilesService` — caps, conflicts, bulk results

**Files:**

- Create: `backend/src/files/files.service.ts`
- Test: `backend/src/files/files.service.spec.ts`
- Modify: `backend/src/servers/servers.service.ts`

**Interfaces:**

- Consumes: `ServerFsService` (Task 2), `ArchiveService` (Task 3).
- Produces:
  - `ServersService.assertServerExists(id: string): Promise<void>` — throws `NotFoundException`
  - `FilesService.list(serverId, rel): Promise<FileEntry[]>`
  - `.readText(serverId, rel): Promise<{ content: string; mtimeMs: number }>` — throws `UnsupportedMediaTypeException` for binary, `PayloadTooLargeException` over 2 MB
  - `.writeText(serverId, rel, content, mtimeMs?): Promise<{ mtimeMs: number }>` — throws `ConflictException` on mtime mismatch
  - `.mkdir`, `.rename`
  - `.removeMany(serverId, paths: string[]): Promise<BulkResult[]>` where `interface BulkResult { path: string; ok: boolean; error?: string }`
  - `.search(serverId, query, limit)`
  - `.extract(serverId, rel, dest)`, `.compress(serverId, paths, dest)`
  - constant `MAX_TEXT_BYTES = 2 * 1024 * 1024`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/files/files.service.spec.ts
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
    const { filesService } = makeService();
    const serversService = {
      assertServerExists: jest
        .fn()
        .mockRejectedValue(new NotFoundException('gone')),
    } as unknown as ServersService;
    const svc = new FilesService(
      { root: jest.fn() } as unknown as ServerFsService,
      {} as ArchiveService,
      serversService,
    );
    await expect(svc.list('missing', '')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(filesService).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./backend exec jest src/files/files.service.spec.ts`
Expected: FAIL — `Cannot find module './files.service'`.

- [ ] **Step 3: Add `assertServerExists` to `ServersService`**

```ts
// backend/src/servers/servers.service.ts — add next to resolveContainerId
  /** Existence check for modules that address a server by id but need no record. */
  async assertServerExists(id: string): Promise<void> {
    await this.requireServer(id);
  }
```

- [ ] **Step 4: Write minimal implementation**

```ts
// backend/src/files/files.service.ts
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
import { PathError } from './path';

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
  if (error instanceof PathError || error instanceof Error)
    return error.message;
  return 'unknown error';
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter ./backend exec jest src/files/`
Expected: PASS — all four `files/` spec files.

- [ ] **Step 6: Commit**

```bash
git add backend/src/files/files.service.ts backend/src/files/files.service.spec.ts backend/src/servers/servers.service.ts
git commit -m "feat: add files service with caps, conflicts, and bulk results"
```

---

### Task 5: REST surface — controller, DTOs, module wiring

**Files:**

- Create: `backend/src/files/dto/file-path.dto.ts`, `dto/write-file.dto.ts`, `dto/rename.dto.ts`, `dto/paths.dto.ts`, `dto/extract.dto.ts`, `dto/compress.dto.ts`
- Create: `backend/src/files/files.controller.ts`, `backend/src/files/files.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/files.e2e-spec.ts`

**Interfaces:**

- Consumes: `FilesService` (Task 4), `JwtAuthGuard` (`../auth/jwt-auth.guard`).
- Produces: routes under `/servers/:id/files`, as in the spec's endpoint table.

- [ ] **Step 1: Write the failing e2e test**

```ts
// backend/test/files.e2e-spec.ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { FilesService } from '../src/files/files.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

describe('files routes (e2e)', () => {
  let app: INestApplication;
  const filesService = {
    list: jest
      .fn()
      .mockResolvedValue([
        { name: 'mods', type: 'dir', sizeBytes: 0, mtimeMs: 1 },
      ]),
    writeText: jest.fn().mockResolvedValue({ mtimeMs: 5 }),
    removeMany: jest.fn().mockResolvedValue([{ path: 'a', ok: true }]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FilesService)
      .useValue(filesService)
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists a directory', async () => {
    const res = await request(app.getHttpServer())
      .get('/servers/s1/files?path=/')
      .expect(200);
    expect(res.body).toEqual([
      { name: 'mods', type: 'dir', sizeBytes: 0, mtimeMs: 1 },
    ]);
    expect(filesService.list).toHaveBeenCalledWith('s1', '/');
  });

  it('rejects a write with a missing path', async () => {
    await request(app.getHttpServer())
      .put('/servers/s1/files/content')
      .send({ content: 'x' })
      .expect(400);
  });

  it('passes mtimeMs through on write', async () => {
    await request(app.getHttpServer())
      .put('/servers/s1/files/content')
      .send({ path: 'server.properties', content: 'a=1', mtimeMs: 42 })
      .expect(200);
    expect(filesService.writeText).toHaveBeenCalledWith(
      's1',
      'server.properties',
      'a=1',
      42,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./backend run test:e2e -- files`
Expected: FAIL — `FilesService` cannot be resolved / route 404.

- [ ] **Step 3: Write the DTOs**

```ts
// backend/src/files/dto/file-path.dto.ts
import { IsString, MaxLength } from 'class-validator';

export class FilePathDto {
  @IsString()
  @MaxLength(1024)
  path!: string;
}
```

```ts
// backend/src/files/dto/write-file.dto.ts
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class WriteFileDto {
  @IsString()
  @MaxLength(1024)
  path!: string;

  @IsString()
  content!: string;

  /** mtime the editor loaded; omit to force-overwrite. */
  @IsOptional()
  @IsInt()
  mtimeMs?: number;
}
```

```ts
// backend/src/files/dto/rename.dto.ts
import { IsString, MaxLength } from 'class-validator';

export class RenameDto {
  @IsString()
  @MaxLength(1024)
  from!: string;

  @IsString()
  @MaxLength(1024)
  to!: string;
}
```

```ts
// backend/src/files/dto/paths.dto.ts
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class PathsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  paths!: string[];
}
```

```ts
// backend/src/files/dto/extract.dto.ts
import { IsString, MaxLength } from 'class-validator';

export class ExtractDto {
  @IsString()
  @MaxLength(1024)
  path!: string;

  @IsString()
  @MaxLength(1024)
  dest!: string;
}
```

```ts
// backend/src/files/dto/compress.dto.ts
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class CompressDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  paths!: string[];

  @IsString()
  @MaxLength(1024)
  dest!: string;
}
```

- [ ] **Step 4: Write the controller and module**

```ts
// backend/src/files/files.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BulkResult, FilesService } from './files.service';
import { FileEntry } from './server-fs.service';
import { WriteFileDto } from './dto/write-file.dto';
import { FilePathDto } from './dto/file-path.dto';
import { RenameDto } from './dto/rename.dto';
import { PathsDto } from './dto/paths.dto';
import { ExtractDto } from './dto/extract.dto';
import { CompressDto } from './dto/compress.dto';

@UseGuards(JwtAuthGuard)
@Controller('servers/:id/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  list(
    @Param('id') id: string,
    @Query('path') path = '',
  ): Promise<FileEntry[]> {
    return this.filesService.list(id, path);
  }

  @Get('content')
  read(
    @Param('id') id: string,
    @Query('path') path: string,
  ): Promise<{ content: string; mtimeMs: number }> {
    return this.filesService.readText(id, path);
  }

  @Put('content')
  write(
    @Param('id') id: string,
    @Body() dto: WriteFileDto,
  ): Promise<{ mtimeMs: number }> {
    return this.filesService.writeText(id, dto.path, dto.content, dto.mtimeMs);
  }

  @Post('dir')
  async mkdir(
    @Param('id') id: string,
    @Body() dto: FilePathDto,
  ): Promise<{ ok: true }> {
    await this.filesService.mkdir(id, dto.path);
    return { ok: true };
  }

  @Post('rename')
  async rename(
    @Param('id') id: string,
    @Body() dto: RenameDto,
  ): Promise<{ ok: true }> {
    await this.filesService.rename(id, dto.from, dto.to);
    return { ok: true };
  }

  @Post('delete')
  remove(
    @Param('id') id: string,
    @Body() dto: PathsDto,
  ): Promise<BulkResult[]> {
    return this.filesService.removeMany(id, dto.paths);
  }

  @Get('search')
  search(
    @Param('id') id: string,
    @Query('q') q: string,
    @Query('limit') limit = '100',
  ): Promise<string[]> {
    return this.filesService.search(id, q, Number(limit) || 100);
  }

  @Post('extract')
  async extract(
    @Param('id') id: string,
    @Body() dto: ExtractDto,
  ): Promise<{ ok: true }> {
    await this.filesService.extract(id, dto.path, dto.dest);
    return { ok: true };
  }

  @Post('compress')
  async compress(
    @Param('id') id: string,
    @Body() dto: CompressDto,
  ): Promise<{ ok: true }> {
    await this.filesService.compress(id, dto.paths, dto.dest);
    return { ok: true };
  }
}
```

```ts
// backend/src/files/files.module.ts
import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { AuthModule } from '../auth/auth.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { ServerFsService } from './server-fs.service';
import { ArchiveService } from './archive.service';

@Module({
  imports: [ServersModule, AuthModule],
  controllers: [FilesController],
  providers: [FilesService, ServerFsService, ArchiveService],
  exports: [ServerFsService, ArchiveService],
})
export class FilesModule {}
```

Register it in `backend/src/app.module.ts` — add `FilesModule` to the imports array after `MetricsModule`.

- [ ] **Step 5: Map `PathError` to a 400 at the boundary**

A guard rejection must not surface as a 500. Add to `files.service.ts` a wrapper used by every method that calls into `ServerFsService`:

```ts
// backend/src/files/files.service.ts — add and wrap each fs call site
import { BadRequestException } from '@nestjs/common';

private async guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PathError) throw new BadRequestException(error.message);
    throw error;
  }
}
```

Wrap the bodies of `list`, `readText`, `writeText`, `mkdir`, `rename`, `search`, `extract` and `compress` in `this.guarded(...)`. `removeMany` keeps its per-path catch (it already reports the message), so it is not wrapped.

- [ ] **Step 6: Run the e2e test to verify it passes**

Run: `pnpm --filter ./backend run test:e2e -- files`
Expected: PASS, 3 tests.

- [ ] **Step 7: Run the whole unit suite**

Run: `pnpm --filter ./backend test`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add backend/src/files backend/src/app.module.ts backend/test/files.e2e-spec.ts
git commit -m "feat: expose file manager REST routes"
```

---

### Task 6: Upload and download

**Files:**

- Modify: `backend/src/files/files.controller.ts`, `backend/src/files/files.service.ts`, `backend/src/files/files.module.ts`, `backend/src/config/env.ts`
- Test: `backend/src/files/files.service.spec.ts` (add cases), `backend/test/files.e2e-spec.ts` (add cases)

**Interfaces:**

- Consumes: `FilesService`, `ServerFsService`.
- Produces: `POST /servers/:id/files/upload` (multipart field `file`, query `path` = destination directory), `GET /servers/:id/files/download?path=` (file streams as-is; directory streams as zip). `FilesService.saveUpload(serverId, destDir, tmpPath, filename): Promise<void>`, `FilesService.openDownload(serverId, rel): Promise<{ stream: NodeJS.ReadableStream; filename: string }>`. Optional env `MAX_UPLOAD_MB` (default 512).

- [ ] **Step 1: Add the dev dependency for Multer types**

```bash
pnpm --filter ./backend add -D @types/multer
```

- [ ] **Step 2: Write the failing service tests**

```ts
// backend/src/files/files.service.spec.ts — append inside describe('FilesService')
it('moves an upload into the destination directory', async () => {
  const { filesService, fs } = makeService();
  fs.resolve.mockImplementation(async (_id, rel) => `/srv/mc/s1/data/${rel}`);
  const moved: string[] = [];
  (
    filesService as unknown as { move: (a: string, b: string) => Promise<void> }
  ).move = async (from, to) => {
    moved.push(`${from}->${to}`);
  };

  await filesService.saveUpload('s1', 'mods', '/tmp/up123', 'cool-mod.jar');

  expect(moved).toEqual(['/tmp/up123->/srv/mc/s1/data/mods/cool-mod.jar']);
});

it('refuses an upload filename containing a path separator', async () => {
  const { filesService } = makeService();
  await expect(
    filesService.saveUpload('s1', 'mods', '/tmp/up123', '../evil.jar'),
  ).rejects.toThrow();
});

it('zips a directory for download', async () => {
  const { filesService, fs } = makeService();
  fs.stat.mockResolvedValue({
    name: 'config',
    type: 'dir',
    sizeBytes: 0,
    mtimeMs: 1,
  });
  const opened = await filesService.openDownload('s1', 'config');
  expect(opened.filename).toBe('config.zip');
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter ./backend exec jest src/files/files.service.spec.ts`
Expected: FAIL — `filesService.saveUpload is not a function`.

- [ ] **Step 4: Implement upload and download in the service**

```ts
// backend/src/files/files.service.ts — additions
import { createReadStream } from 'node:fs';
import { rename as fsRename, rm, stat as fsStat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

  /**
   * Multer has already streamed the body to `tmpPath`; this only validates the
   * name and moves it into place. `rename` can cross devices (tmp is often a
   * different mount), so fall back to a copy when it does.
   */
  async saveUpload(
    serverId: string,
    destDir: string,
    tmpPath: string,
    filename: string,
  ): Promise<void> {
    await this.serversService.assertServerExists(serverId);
    if (filename !== path.basename(filename) || filename.includes('\0')) {
      await rm(tmpPath, { force: true });
      throw new BadRequestException('invalid upload filename');
    }
    return this.guarded(async () => {
      const target = await this.serverFsService.resolve(
        serverId,
        path.join(destDir, filename),
      );
      await this.move(tmpPath, target);
    });
  }

  async openDownload(
    serverId: string,
    rel: string,
  ): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    await this.serversService.assertServerExists(serverId);
    return this.guarded(async () => {
      const info = await this.serverFsService.stat(serverId, rel);
      if (info.type === 'file') {
        return {
          stream: await this.serverFsService.createReadStream(serverId, rel),
          filename: info.name,
        };
      }
      // Directories are zipped into a temp file first: streaming an archive
      // whose size is unknown breaks resumable downloads and hides errors
      // behind a 200 that was already sent.
      const zipPath = path.join(
        tmpdir(),
        `mc-dl-${randomBytes(8).toString('hex')}.zip`,
      );
      await this.archiveService.createZip(
        this.serverFsService.root(serverId),
        [rel],
        zipPath,
      );
      const stream = createReadStream(zipPath);
      stream.on('close', () => void rm(zipPath, { force: true }));
      return { stream, filename: `${info.name}.zip` };
    });
  }

  private async move(from: string, to: string): Promise<void> {
    try {
      await fsRename(from, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      const { copyFile } = await import('node:fs/promises');
      await copyFile(from, to);
      await rm(from, { force: true });
    }
    await fsStat(to);
  }
```

- [ ] **Step 5: Wire the routes**

```ts
// backend/src/files/files.controller.ts — additions
import { Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'node:os';
import type { Response } from 'express';

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 512);

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
    }),
  )
  async upload(
    @Param('id') id: string,
    @Query('path') destDir = '',
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ ok: true }> {
    await this.filesService.saveUpload(
      id,
      destDir,
      file.path,
      file.originalname,
    );
    return { ok: true };
  }

  @Get('download')
  async download(
    @Param('id') id: string,
    @Query('path') path: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, filename } = await this.filesService.openDownload(id, path);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    });
    return new StreamableFile(stream as NodeJS.ReadableStream);
  }
```

- [ ] **Step 6: Document the optional env var**

In `backend/src/config/env.ts`, leave `REQUIRED_ENV` untouched and add the comment block above it:

```ts
/**
 * Optional vars (defaulted, never required):
 *   MC_DATA_ROOT  — per-server data root (default /srv/mc)
 *   MC_IMAGE      — server image (default itzg/minecraft-server)
 *   MAX_UPLOAD_MB — file-manager upload cap in MB (default 512)
 */
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter ./backend test && pnpm --filter ./backend run test:e2e -- files`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/files backend/src/config/env.ts backend/package.json pnpm-lock.yaml
git commit -m "feat: add file upload and download routes"
```

---

### Task 7: Remove a server's data root on delete

**Files:**

- Modify: `backend/src/servers/servers.service.ts`, `backend/src/servers/docker.service.ts`
- Test: `backend/src/servers/servers.service.spec.ts`

**Interfaces:**

- Consumes: `serverRoot` (Task 1).
- Produces: `DockerService.serverRoot(id: string): string`; `ServersService.deleteServer` now removes `<MC_DATA_ROOT>/<id>` recursively.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/servers/servers.service.spec.ts — append to the delete describe block
it('removes the server data root so files and backups do not leak', async () => {
  const removed: string[] = [];
  const serversService = makeService({
    dockerService: {
      remove: jest.fn().mockResolvedValue(undefined),
      serverRoot: jest.fn().mockReturnValue('/srv/mc/s1'),
    },
    removeTree: async (dir: string) => {
      removed.push(dir);
    },
  });

  await serversService.deleteServer('s1');

  expect(removed).toEqual(['/srv/mc/s1']);
});
```

Adapt `makeService` to the helper already used in that file; pass the `removeTree` collaborator through the constructor only if the existing file already threads collaborators that way — otherwise assert on a `jest.spyOn(fsPromises, 'rm')` call instead, matching the file's established style.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./backend exec jest src/servers/servers.service.spec.ts`
Expected: FAIL — data root is never removed.

- [ ] **Step 3: Implement**

```ts
// backend/src/servers/docker.service.ts — add next to dataDir
import { serverRoot as serverRootOf } from './paths';

  serverRoot(id: string): string {
    return serverRootOf(this.dataRoot, id);
  }
```

```ts
// backend/src/servers/servers.service.ts
import { rm } from 'node:fs/promises';

  async deleteServer(id: string): Promise<void> {
    const server = await this.requireServer(id);
    if (server.containerId) {
      await this.dockerService.remove(server.containerId).catch(() => undefined);
    }
    await this.serverRepository.delete(id);
    // The row is gone, so nothing can address these files any more. Removing
    // the whole per-server root takes data/ and backups/ together; leaving it
    // behind leaked a full server tree on every delete.
    await rm(this.dockerService.serverRoot(id), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter ./backend exec jest src/servers/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/servers
git commit -m "fix: remove server data root on delete"
```

---

### Task 8: Frontend data layer

**Files:**

- Create: `frontend/src/modules/files/api.ts`, `hooks.ts`, `index.ts`
- Modify: `frontend/src/types/api.ts`, `frontend/src/constants/index.ts`
- Test: `frontend/src/modules/files/hooks.test.ts`

**Interfaces:**

- Consumes: `api` from `@/lib/api-client`, `QUERY_KEYS` from `@/constants`.
- Produces:
  - types `FileEntry { name; type: 'file' | 'dir'; sizeBytes: number; mtimeMs: number }`, `FileContent { content: string; mtimeMs: number }`, `BulkResult { path: string; ok: boolean; error?: string }`
  - `QUERY_KEYS.files(id, path)`, `QUERY_KEYS.fileContent(id, path)`
  - `useFiles(serverId, path)`, `useFileContent(serverId, path | null)`, `useSaveFile(serverId)`, `useFileOps(serverId)` → `{ mkdir, rename, remove, extract, compress, upload }` mutations, `downloadUrl(serverId, path)`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/modules/files/hooks.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useFiles } from './hooks';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

describe('useFiles', () => {
  it('fetches the directory listing for a path', async () => {
    const entries = [{ name: 'mods', type: 'dir', sizeBytes: 0, mtimeMs: 1 }];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(entries),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useFiles('s1', 'config'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(entries));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/servers/s1/files?path=config'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./frontend test -- src/modules/files`
Expected: FAIL — cannot resolve `./hooks`.

- [ ] **Step 3: Add the types and query keys**

```ts
// frontend/src/types/api.ts — append
export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  sizeBytes: number;
  mtimeMs: number;
}

export interface FileContent {
  content: string;
  mtimeMs: number;
}

export interface BulkResult {
  path: string;
  ok: boolean;
  error?: string;
}
```

```ts
// frontend/src/constants/index.ts — inside QUERY_KEYS
  files: (id: string, path: string) => ['servers', id, 'files', path] as const,
  fileContent: (id: string, path: string) =>
    ['servers', id, 'file', path] as const,
```

- [ ] **Step 4: Write the api module**

```ts
// frontend/src/modules/files/api.ts
import { api } from '@/lib/api-client';
import { API_URL } from '@/constants';
import type { BulkResult, FileContent, FileEntry } from '@/types';

const base = (serverId: string) => `/servers/${serverId}/files`;

export const listFiles = (serverId: string, path: string) =>
  api<FileEntry[]>(`${base(serverId)}?path=${encodeURIComponent(path)}`);

export const readFile = (serverId: string, path: string) =>
  api<FileContent>(
    `${base(serverId)}/content?path=${encodeURIComponent(path)}`,
  );

export const writeFile = (
  serverId: string,
  body: { path: string; content: string; mtimeMs?: number },
) =>
  api<{ mtimeMs: number }>(`${base(serverId)}/content`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const makeDir = (serverId: string, path: string) =>
  api<{ ok: true }>(`${base(serverId)}/dir`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

export const renamePath = (serverId: string, from: string, to: string) =>
  api<{ ok: true }>(`${base(serverId)}/rename`, {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });

export const deletePaths = (serverId: string, paths: string[]) =>
  api<BulkResult[]>(`${base(serverId)}/delete`, {
    method: 'POST',
    body: JSON.stringify({ paths }),
  });

export const searchFiles = (serverId: string, q: string) =>
  api<string[]>(`${base(serverId)}/search?q=${encodeURIComponent(q)}`);

export const extractArchive = (serverId: string, path: string, dest: string) =>
  api<{ ok: true }>(`${base(serverId)}/extract`, {
    method: 'POST',
    body: JSON.stringify({ path, dest }),
  });

export const compressPaths = (
  serverId: string,
  paths: string[],
  dest: string,
) =>
  api<{ ok: true }>(`${base(serverId)}/compress`, {
    method: 'POST',
    body: JSON.stringify({ paths, dest }),
  });

/** Multipart upload bypasses `api()` — it must not set a JSON content type. */
export async function uploadFile(
  serverId: string,
  destDir: string,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(
    `${API_URL}${base(serverId)}/upload?path=${encodeURIComponent(destDir)}`,
    { method: 'POST', credentials: 'include', body: form },
  );
  if (!res.ok) throw new Error(await res.text());
}

export const downloadUrl = (serverId: string, path: string) =>
  `${API_URL}${base(serverId)}/download?path=${encodeURIComponent(path)}`;
```

- [ ] **Step 5: Write the hooks module**

```ts
// frontend/src/modules/files/hooks.ts
'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import type { FileContent, FileEntry } from '@/types';
import {
  compressPaths,
  deletePaths,
  extractArchive,
  listFiles,
  makeDir,
  readFile,
  renamePath,
  searchFiles,
  uploadFile,
  writeFile,
} from './api';

export function useFiles(serverId: string, path: string) {
  return useQuery<FileEntry[]>({
    queryKey: QUERY_KEYS.files(serverId, path),
    queryFn: () => listFiles(serverId, path),
  });
}

export function useFileContent(serverId: string, path: string | null) {
  return useQuery<FileContent>({
    queryKey: QUERY_KEYS.fileContent(serverId, path ?? ''),
    queryFn: () => readFile(serverId, path as string),
    enabled: path !== null,
  });
}

export function useSaveFile(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { path: string; content: string; mtimeMs?: number }) =>
      writeFile(serverId, body),
    onSuccess: (_result, body) =>
      qc.invalidateQueries({
        queryKey: QUERY_KEYS.fileContent(serverId, body.path),
      }),
  });
}

export function useFileOps(serverId: string, path: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ['servers', serverId, 'files'] });
  return {
    mkdir: useMutation({
      mutationFn: (dir: string) => makeDir(serverId, dir),
      onSuccess: invalidate,
    }),
    rename: useMutation({
      mutationFn: (args: { from: string; to: string }) =>
        renamePath(serverId, args.from, args.to),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (paths: string[]) => deletePaths(serverId, paths),
      onSuccess: invalidate,
    }),
    extract: useMutation({
      mutationFn: (args: { path: string; dest: string }) =>
        extractArchive(serverId, args.path, args.dest),
      onSuccess: invalidate,
    }),
    compress: useMutation({
      mutationFn: (args: { paths: string[]; dest: string }) =>
        compressPaths(serverId, args.paths, args.dest),
      onSuccess: invalidate,
    }),
    upload: useMutation({
      mutationFn: (file: File) => uploadFile(serverId, path, file),
      onSuccess: invalidate,
    }),
  };
}

export function useFileSearch(serverId: string, q: string) {
  return useQuery<string[]>({
    queryKey: ['servers', serverId, 'file-search', q],
    queryFn: () => searchFiles(serverId, q),
    enabled: q.length >= 2,
  });
}
```

```ts
// frontend/src/modules/files/index.ts
export * from './hooks';
export { downloadUrl } from './api';
export { FilesTab } from './components/FilesTab';
```

`index.ts` will not typecheck until Task 10 creates `FilesTab`; add the export line then. For this task, export only the hooks and `downloadUrl`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter ./frontend test -- src/modules/files`
Expected: PASS, 1 test.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/files frontend/src/types/api.ts frontend/src/constants/index.ts
git commit -m "feat: add files api and hooks to the frontend"
```

---

### Task 9: `Checkbox` and `ConfirmDialog` primitives

**Files:**

- Create: `frontend/src/ui/Checkbox.tsx`, `frontend/src/ui/ConfirmDialog.tsx`
- Modify: `frontend/src/ui/index.ts`
- Test: `frontend/src/ui/ConfirmDialog.test.tsx`

**Interfaces:**

- Consumes: existing `Modal`, `Button` from `@ui`.
- Produces: `Checkbox({ checked, onChange, label? })`, `ConfirmDialog({ open, title, body, confirmLabel, danger?, onConfirm, onCancel })`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/ui/ConfirmDialog.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('calls onConfirm only when the confirm button is pressed', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        open
        title="Delete 2 files?"
        body="This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Nope"
        body=""
        confirmLabel="Go"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.queryByText('Nope')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./frontend test -- src/ui/ConfirmDialog`
Expected: FAIL — cannot resolve `./ConfirmDialog`.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/ui/Checkbox.tsx
'use client';

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-neutral-600 bg-neutral-800"
      />
      {label}
    </label>
  );
}
```

```tsx
// frontend/src/ui/ConfirmDialog.tsx
'use client';
import { Button } from './Button';
import { Modal } from './Modal';

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm text-neutral-300">{body}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
```

Check `frontend/src/ui/Modal.tsx` and `Button.tsx` for their actual prop names before writing this — match them exactly rather than the names assumed here (in particular the `variant` values and whether `Modal` takes `title`/`onClose`).

- [ ] **Step 4: Export both**

```ts
// frontend/src/ui/index.ts — append
export { Checkbox } from './Checkbox';
export { ConfirmDialog } from './ConfirmDialog';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter ./frontend test -- src/ui/ConfirmDialog`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/ui
git commit -m "feat: add checkbox and confirm dialog primitives"
```

---

### Task 10: Files tab — browse, select, delete

**Files:**

- Create: `frontend/src/modules/files/components/Breadcrumb.tsx`, `FileTable.tsx`, `FilesTab.tsx`
- Modify: `frontend/src/modules/files/index.ts`, `frontend/src/app/(panel)/servers/[id]/page.tsx`
- Test: `frontend/src/modules/files/components/FileTable.test.tsx`, `FilesTab.test.tsx`

**Interfaces:**

- Consumes: `useFiles`, `useFileOps`, `downloadUrl` (Task 8); `Checkbox`, `ConfirmDialog`, `Button`, `Spinner` from `@ui`.
- Produces: `FilesTab({ serverId }: { serverId: string })`, exported from `@/modules/files`.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/modules/files/components/FileTable.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileTable } from './FileTable';

const entries = [
  { name: 'mods', type: 'dir' as const, sizeBytes: 0, mtimeMs: 1700000000000 },
  {
    name: 'server.properties',
    type: 'file' as const,
    sizeBytes: 2048,
    mtimeMs: 1700000000000,
  },
];

describe('FileTable', () => {
  it('shows directories first with a human-readable size', () => {
    render(
      <FileTable
        entries={entries}
        selected={new Set()}
        onToggle={jest.fn()}
        onOpen={jest.fn()}
        serverId="s1"
      />,
    );
    const rows = screen.getAllByRole('row').slice(1); // skip the header
    expect(rows[0]).toHaveTextContent('mods');
    expect(rows[1]).toHaveTextContent('2.0 KB');
  });

  it('opens an entry on name click', async () => {
    const onOpen = jest.fn();
    render(
      <FileTable
        entries={entries}
        selected={new Set()}
        onToggle={jest.fn()}
        onOpen={onOpen}
        serverId="s1"
      />,
    );
    await userEvent.click(screen.getByText('mods'));
    expect(onOpen).toHaveBeenCalledWith(entries[0]);
  });
});
```

```tsx
// frontend/src/modules/files/components/FilesTab.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilesTab } from './FilesTab';

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FilesTab serverId="s1" />
    </QueryClientProvider>,
  );
}

describe('FilesTab', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          { name: 'config', type: 'dir', sizeBytes: 0, mtimeMs: 1 },
        ]),
    }) as unknown as typeof fetch;
  });

  it('navigates into a directory and back via the breadcrumb', async () => {
    renderTab();
    await userEvent.click(await screen.findByText('config'));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('path=config'),
        expect.anything(),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'data' }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('path='),
        expect.anything(),
      ),
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter ./frontend test -- src/modules/files/components`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the components**

```tsx
// frontend/src/modules/files/components/Breadcrumb.tsx
'use client';

export function Breadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const parts = path.split('/').filter(Boolean);
  return (
    <nav className="flex items-center gap-1 text-sm text-neutral-400">
      <button
        type="button"
        onClick={() => onNavigate('')}
        className="hover:text-white"
      >
        data
      </button>
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className="flex items-center gap-1">
          <span>/</span>
          <button
            type="button"
            className="hover:text-white"
            onClick={() => onNavigate(parts.slice(0, i + 1).join('/'))}
          >
            {part}
          </button>
        </span>
      ))}
    </nav>
  );
}
```

```tsx
// frontend/src/modules/files/components/FileTable.tsx
'use client';
import { Checkbox } from '@ui';
import type { FileEntry } from '@/types';
import { downloadUrl } from '../api';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function FileTable({
  entries,
  selected,
  onToggle,
  onOpen,
  serverId,
  basePath = '',
}: {
  entries: FileEntry[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onOpen: (entry: FileEntry) => void;
  serverId: string;
  basePath?: string;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-neutral-500">
        <tr>
          <th className="w-8" />
          <th>Name</th>
          <th className="w-28">Size</th>
          <th className="w-44">Modified</th>
          <th className="w-20" />
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.name} className="border-t border-neutral-800">
            <td>
              <Checkbox
                checked={selected.has(entry.name)}
                onChange={() => onToggle(entry.name)}
              />
            </td>
            <td>
              <button
                type="button"
                className="hover:underline"
                onClick={() => onOpen(entry)}
              >
                {entry.type === 'dir' ? '📁 ' : ''}
                {entry.name}
              </button>
            </td>
            <td>{entry.type === 'dir' ? '—' : humanSize(entry.sizeBytes)}</td>
            <td>{new Date(entry.mtimeMs).toLocaleString()}</td>
            <td>
              <a
                className="text-neutral-400 hover:text-white"
                href={downloadUrl(
                  serverId,
                  basePath ? `${basePath}/${entry.name}` : entry.name,
                )}
              >
                Download
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

```tsx
// frontend/src/modules/files/components/FilesTab.tsx
'use client';
import { useState } from 'react';
import { Button, ConfirmDialog, Spinner } from '@ui';
import type { FileEntry } from '@/types';
import { useFileOps, useFiles } from '../hooks';
import { Breadcrumb } from './Breadcrumb';
import { FileTable } from './FileTable';

export function FilesTab({ serverId }: { serverId: string }) {
  const [path, setPath] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: entries, isLoading, isError } = useFiles(serverId, path);
  const ops = useFileOps(serverId, path);

  const join = (name: string) => (path ? `${path}/${name}` : name);

  function navigate(next: string): void {
    setSelected(new Set());
    setPath(next);
  }

  function toggle(name: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function open(entry: FileEntry): void {
    if (entry.type === 'dir') navigate(join(entry.name));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Breadcrumb path={path} onNavigate={navigate} />
        {selected.size > 0 && (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete {selected.size}
          </Button>
        )}
      </div>
      {isLoading && <Spinner />}
      {isError && <p className="text-red-400">Could not read this folder.</p>}
      {entries && (
        <FileTable
          entries={entries}
          selected={selected}
          onToggle={toggle}
          onOpen={open}
          serverId={serverId}
          basePath={path}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${selected.size} item(s)?`}
        body="Deleted files are gone immediately. The server may still hold open files it is using."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          ops.remove.mutate([...selected].map(join), {
            onSuccess: () => setSelected(new Set()),
          });
          setConfirmDelete(false);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Wire the tab into the server page**

```tsx
// frontend/src/app/(panel)/servers/[id]/page.tsx
import { FilesTab } from '@/modules/files';

type TabKey = 'console' | 'metrics' | 'files' | 'settings';
// ... in the tabs array, between metrics and settings:
          { key: 'files', label: 'Files' },
// ... in the body:
      {tab === 'files' && <FilesTab serverId={server.id} />}
```

Add `export { FilesTab } from './components/FilesTab';` to `frontend/src/modules/files/index.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ./frontend test -- src/modules/files`
Expected: PASS, 4 tests (2 hooks + 2 component files).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/files frontend/src/app
git commit -m "feat: add files tab with browsing and bulk delete"
```

---

### Task 11: File editor with conflict detection

**Files:**

- Create: `frontend/src/modules/files/components/FileEditor.tsx`
- Modify: `frontend/src/modules/files/components/FilesTab.tsx`
- Test: `frontend/src/modules/files/components/FileEditor.test.tsx`

**Interfaces:**

- Consumes: `useFileContent`, `useSaveFile` (Task 8); `ApiError` from `@/lib/api-client`.
- Produces: `FileEditor({ serverId, path, onClose })`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/modules/files/components/FileEditor.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileEditor } from './FileEditor';

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FileEditor serverId="s1" path="server.properties" onClose={jest.fn()} />
    </QueryClientProvider>,
  );
}

describe('FileEditor', () => {
  it('loads content and sends the loaded mtime back on save', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ content: 'level-name=world', mtimeMs: 111 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ mtimeMs: 222 }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderEditor();
    const box = await screen.findByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'level-name=new');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      path: 'server.properties',
      content: 'level-name=new',
      mtimeMs: 111,
    });
  });

  it('surfaces a 409 as a changed-on-disk warning', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ content: 'a', mtimeMs: 111 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        text: async () =>
          JSON.stringify({ code: 'FILE_CHANGED', message: 'changed on disk' }),
      }) as unknown as typeof fetch;

    renderEditor();
    await screen.findByRole('textbox');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/changed on disk/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./frontend test -- FileEditor`
Expected: FAIL — cannot resolve `./FileEditor`.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/modules/files/components/FileEditor.tsx
'use client';
import { useState } from 'react';
import { Button, Spinner } from '@ui';
import { errorText } from '@/lib/errors';
import { useFileContent, useSaveFile } from '../hooks';

export function FileEditor({
  serverId,
  path,
  onClose,
}: {
  serverId: string;
  path: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useFileContent(serverId, path);
  const save = useSaveFile(serverId);
  const [draft, setDraft] = useState<string | null>(null);

  if (isLoading) return <Spinner />;
  if (isError || !data)
    return <p className="text-red-400">{errorText(error)}</p>;

  const content = draft ?? data.content;
  const dirty = draft !== null && draft !== data.content;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm">{path}</span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              if (
                !dirty ||
                window.confirm('Discard unsaved changes to this file?')
              ) {
                onClose();
              }
            }}
          >
            Close
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ path, content, mtimeMs: data.mtimeMs })
            }
          >
            Save
          </Button>
        </div>
      </div>
      <textarea
        className="h-[28rem] w-full rounded border border-neutral-800 bg-neutral-950 p-3 font-mono text-sm"
        value={content}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
      />
      {save.isError && <p className="text-red-400">{errorText(save.error)}</p>}
      <p className="text-xs text-neutral-500">
        Most settings are read when the server starts — restart it for changes
        to take effect.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Open files from the table**

In `FilesTab.tsx`, add `const [editing, setEditing] = useState<string | null>(null);`, extend `open()` so a `file` entry calls `setEditing(join(entry.name))`, and render the editor in place of the table when `editing !== null`:

```tsx
if (editing !== null) {
  return (
    <FileEditor
      serverId={serverId}
      path={editing}
      onClose={() => setEditing(null)}
    />
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ./frontend test -- src/modules/files`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/files
git commit -m "feat: add file editor with conflict detection"
```

---

### Task 12: Toolbar — upload, new folder, search, extract, compress

**Files:**

- Create: `frontend/src/modules/files/components/FileToolbar.tsx`
- Modify: `frontend/src/modules/files/components/FilesTab.tsx`
- Test: `frontend/src/modules/files/components/FileToolbar.test.tsx`

**Interfaces:**

- Consumes: `useFileOps`, `useFileSearch` (Task 8).
- Produces: `FileToolbar({ serverId, path, selected, onSearchSelect })`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/modules/files/components/FileToolbar.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileToolbar } from './FileToolbar';

function renderToolbar(selected: string[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FileToolbar
        serverId="s1"
        path="mods"
        selected={new Set(selected)}
        onSearchSelect={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('FileToolbar', () => {
  it('creates a folder under the current path', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(window, 'prompt').mockReturnValue('newdir');

    renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      path: 'mods/newdir',
    });
  });

  it('only offers Compress when something is selected', () => {
    const { rerender } = renderToolbar();
    expect(
      screen.queryByRole('button', { name: 'Compress' }),
    ).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <FileToolbar
          serverId="s1"
          path="mods"
          selected={new Set(['a.jar'])}
          onSearchSelect={jest.fn()}
        />
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole('button', { name: 'Compress' }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./frontend test -- FileToolbar`
Expected: FAIL — cannot resolve `./FileToolbar`.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/modules/files/components/FileToolbar.tsx
'use client';
import { useRef, useState } from 'react';
import { Button, Input } from '@ui';
import { useFileOps, useFileSearch } from '../hooks';

export function FileToolbar({
  serverId,
  path,
  selected,
  onSearchSelect,
}: {
  serverId: string;
  path: string;
  selected: Set<string>;
  onSearchSelect: (path: string) => void;
}) {
  const ops = useFileOps(serverId, path);
  const [query, setQuery] = useState('');
  const { data: hits } = useFileSearch(serverId, query);
  const fileInput = useRef<HTMLInputElement>(null);

  const join = (name: string) => (path ? `${path}/${name}` : name);
  const selectedPaths = [...selected].map(join);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) ops.upload.mutate(file);
          e.target.value = '';
        }}
      />
      <Button onClick={() => fileInput.current?.click()}>Upload</Button>
      <Button
        variant="ghost"
        onClick={() => {
          const name = window.prompt('Folder name');
          if (name) ops.mkdir.mutate(join(name));
        }}
      >
        New folder
      </Button>
      {selected.size === 1 &&
        [...selected][0].toLowerCase().endsWith('.zip') && (
          <Button
            variant="ghost"
            onClick={() =>
              ops.extract.mutate({ path: selectedPaths[0], dest: path })
            }
          >
            Extract
          </Button>
        )}
      {selected.size > 0 && (
        <Button
          variant="ghost"
          onClick={() => {
            const name = window.prompt('Archive name', 'archive.zip');
            if (name)
              ops.compress.mutate({ paths: selectedPaths, dest: join(name) });
          }}
        >
          Compress
        </Button>
      )}
      <div className="ml-auto flex flex-col">
        <Input
          placeholder="Search files"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {hits && hits.length > 0 && query.length >= 2 && (
          <ul className="mt-1 max-h-48 overflow-auto rounded border border-neutral-800 bg-neutral-900 text-sm">
            {hits.map((hit) => (
              <li key={hit}>
                <button
                  type="button"
                  className="w-full px-2 py-1 text-left hover:bg-neutral-800"
                  onClick={() => {
                    setQuery('');
                    onSearchSelect(hit);
                  }}
                >
                  {hit}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount it in `FilesTab`**

Render `<FileToolbar serverId={serverId} path={path} selected={selected} onSearchSelect={(hit) => setEditing(hit)} />` directly under the breadcrumb row.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ./frontend test -- src/modules/files`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/files
git commit -m "feat: add file toolbar with upload, mkdir, search, and archives"
```

---

### Task 13: Playwright coverage and docs

**Files:**

- Modify: `frontend/e2e/mocks.ts`, `frontend/e2e/panel.spec.ts`, `backend/AGENTS.md`, `AGENTS.md`

**Interfaces:**

- Consumes: everything above.
- Produces: an end-to-end browse → open → edit → save path exercised against route mocks, and module documentation an agent reads before touching `files/`.

- [ ] **Step 1: Add the route mocks**

```ts
// frontend/e2e/mocks.ts — add alongside the existing mocks
export async function mockFiles(page: Page): Promise<void> {
  await page.route('**/servers/*/files?path=*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { name: 'server.properties', type: 'file', sizeBytes: 20, mtimeMs: 1 },
      ]),
    }),
  );
  await page.route('**/servers/*/files/content*', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mtimeMs: 2 }),
        })
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ content: 'level-name=world', mtimeMs: 1 }),
        }),
  );
}
```

- [ ] **Step 2: Write the failing e2e test**

```ts
// frontend/e2e/panel.spec.ts — append
test('edits a config file from the Files tab', async ({ page }) => {
  await mockFiles(page);
  await page.goto('/servers/s1');
  await page.getByRole('button', { name: 'Files' }).click();
  await page.getByRole('button', { name: 'server.properties' }).click();
  const box = page.getByRole('textbox');
  await expect(box).toHaveValue('level-name=world');
  await box.fill('level-name=new');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/error/i)).toHaveCount(0);
});
```

Match the existing file's login/setup helpers — copy the surrounding test's `beforeEach` usage rather than inventing one.

- [ ] **Step 3: Run it to verify it fails, then passes**

Run: `pnpm --filter ./frontend e2e -- --grep "edits a config file"`
Expected: it fails before the Files tab exists in the build, passes after the prior tasks are in.

- [ ] **Step 4: Document the module**

Add to `backend/AGENTS.md` under the module layout list:

```markdown
- `files/` — `FilesController` (guarded REST) → `FilesService` → `ServerFsService`
  (the ONLY place `node:fs` is used for server data) + `ArchiveService` (the
  ONLY importer of `yauzl` / `archiver`). `path.ts` holds the pure
  `resolveInRoot()` traversal guard; every user-supplied path and every
  archive entry name passes through it. Per-server directory layout lives in
  `servers/paths.ts` (`serverRoot` / `dataDir` / `backupsDir` / `stagingDir`).
  Optional env: `MAX_UPLOAD_MB` (default 512).
```

Add to the root `AGENTS.md` frontend section: `src/modules/files` in the module list.

- [ ] **Step 5: Run the full gate**

Run: `pnpm build && pnpm test && pnpm test:e2e && pnpm fallow && pnpm --filter ./frontend test && pnpm --filter ./frontend typecheck`
Expected: all PASS. Fix anything `fallow` flags as duplicate before committing.

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e backend/AGENTS.md AGENTS.md
git commit -m "test: cover the files tab end to end"
```

---

## Self-Review

**Spec coverage.** Browse/edit/save → Tasks 2, 4, 5, 10, 11. Upload/download/delete/rename/mkdir → Tasks 5, 6, 10, 12. Zip extract/compress → Tasks 3, 5, 12. Search + bulk multi-select → Tasks 2, 4, 10, 12. Path safety (traversal, symlink, zip slip, bombs) → Tasks 1, 2, 3. `deleteServer` data-root cleanup → Task 7. `Checkbox` / `ConfirmDialog` primitives → Task 9. Files tab wiring → Task 10. Documentation → Task 13. The spec's `backupsMb` metric and `Progress` primitive belong to the backups and packs plans, not this one.

**Known follow-ups for the next plans.** `servers/paths.ts` already exports `backupsDir` and `stagingDir` so the backups and packs plans inherit one layout definition. `FilesModule` exports `ServerFsService` and `ArchiveService` for the packs plan to reuse.
