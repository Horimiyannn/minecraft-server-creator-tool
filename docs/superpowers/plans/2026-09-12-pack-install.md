# Pack Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a server be created from a modpack — pasted URL or uploaded file — covering Modrinth `.mrpack`, CurseForge pack zips, and complete server-pack zips (the usual GitHub-release shape), with the pack deciding the loader and Minecraft version when it knows them.

**Architecture:** `backend/src/packs/` holds a pure format layer (`pack-format.ts`: classify, strip-root, mine-loader, launcher-artifact denylist), a streaming downloader with caps and hash verification, and an installer that sequences them. Install runs **only at server creation** and **in the background**: `createServer` returns a row with `status: 'installing'` immediately and the install reports progress over a `/packs` socket room, settling `Server.status` on `running` or `failed`. Any failure rolls the whole server back — container, row, and data root — so no half-built server survives.

**Tech Stack:** Nest 11 (CommonJS), TypeScript 5.9, Jest 29 + ts-jest, socket.io, `yauzl`/`archiver` (reused from the file-manager plan via `FilesModule`), Node `fetch`; frontend Next 16, TanStack Query, socket.io-client.

**Spec:** `docs/superpowers/specs/2026-09-12-files-backups-packs-design.md`

**Depends on:**

- `docs/superpowers/plans/2026-09-12-file-manager.md` — `servers/paths.ts` (`stagingDir`, `dataDir`, `serverRoot`), `ArchiveService`, `ServerFsService`, `resolveInRoot`.
- `docs/superpowers/plans/2026-09-12-backups.md` — not required at runtime, but the `/packs` gateway follows the same handshake-auth pattern the console and metrics gateways already use.

## Global Constraints

- TypeScript **5.9**, Prisma **6.19**, Nest **11**, CommonJS output. **Never** upgrade to TypeScript 7 or Prisma 7.
- pnpm (`pnpm@10.28.1`).
- **Architecture rule (binding):** controller → service → repository. This plan adds no table; it writes through `ServersService` / `ServerRepository` only.
- Inject services as `*Service`-suffixed fields. All logic in services; controllers and gateways only route.
- Pack install happens **at creation only**. There is no endpoint that installs a pack onto an existing server.
- Every download is capped, timed out, redirect-limited, and — for `.mrpack` entries — sha512-verified.
- New optional env vars: `CURSEFORGE_API_KEY` (absent → CurseForge installs fail with a clear message), `MAX_PACK_MB` (default 4096). Neither is added to `REQUIRED_ENV`.
- Never bypass git hooks. pre-push runs `pnpm build && pnpm test && pnpm test:e2e && pnpm fallow`.
- Commit messages: conventional-commit title only, no body.
- Tests: `pnpm --filter ./backend exec jest src/packs/`, `pnpm --filter ./frontend test -- src/modules/packs`.

## File Structure

**Created (backend):**

| Path                                       | Responsibility                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `backend/src/packs/pack-format.ts`         | Pure: `classify`, `stripRoot`, `mineLoader`, `isLauncherArtifact`, manifest parsers |
| `backend/src/packs/pack-downloader.ts`     | Streaming HTTP fetch: size cap, timeout, redirect limit, sha512 verify              |
| `backend/src/packs/curseforge.client.ts`   | Resolves CurseForge project/file ids to download URLs                               |
| `backend/src/packs/pack-installer.ts`      | Sequences classify → resolve → download → extract; emits progress                   |
| `backend/src/packs/packs.gateway.ts`       | `/packs` socket room: install progress                                              |
| `backend/src/packs/packs.controller.ts`    | `POST /packs/staging` multipart upload                                              |
| `backend/src/packs/packs.module.ts`        | Wiring                                                                              |
| `backend/src/packs/dto/pack-source.dto.ts` | `pack` field validation, reused by `CreateServerDto`                                |

**Modified (backend):** `src/servers/provisioning.ts` (+`fabric`), `src/servers/servers.service.ts` (+`createPending` / `launchResolved`), `src/servers/server.repository.ts` (+`setResolvedPack`, `status` on create), `src/app.module.ts`, `src/config/env.ts` (doc comment), `backend/AGENTS.md`. `CreateServerDto` is untouched — the pack flow has its own DTO and route.

**Created (frontend):** `src/modules/packs/{api.ts,hooks.ts,socket.ts,index.ts}`, `src/modules/packs/components/{PackSourceStep,InstallProgress}.tsx`, `src/ui/Progress.tsx`.

**Modified (frontend):** `src/types/api.ts`, `src/constants/index.ts`, `src/ui/index.ts`, `src/modules/servers/components/CreateWizard.tsx`, `src/modules/servers/api.ts`, `src/app/(panel)/servers/[id]/page.tsx`, `e2e/mocks.ts`.

---

### Task 1: Pure pack classification

**Files:**

- Create: `backend/src/packs/pack-format.ts`
- Test: `backend/src/packs/pack-format.spec.ts`

**Interfaces:**

- Consumes: `Loader` from `../servers/provisioning`.
- Produces:
  - `type PackShape = 'mrpack' | 'curseforge' | 'serverpack' | 'mods-only'`
  - `classify(entries: string[]): PackShape`
  - `stripRoot(entries: string[]): string`— the prefix to strip (`''` when none)
  - `isLauncherArtifact(relPath: string): boolean`
  - `interface MinedLoader { loader: Loader; version?: string; loaderVersion?: string }`
  - `mineLoader(entries: string[]): MinedLoader | null`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/packs/pack-format.spec.ts
import {
  classify,
  isLauncherArtifact,
  mineLoader,
  stripRoot,
} from './pack-format';

describe('classify', () => {
  it('detects a Modrinth pack by its index', () => {
    expect(classify(['modrinth.index.json', 'overrides/config/a.toml'])).toBe(
      'mrpack',
    );
  });

  it('detects a CurseForge pack by its manifest', () => {
    expect(classify(['manifest.json', 'overrides/config/a.toml'])).toBe(
      'curseforge',
    );
  });

  it('detects a complete server pack by its content, not its extension', () => {
    expect(
      classify(['mods/jei.jar', 'config/jei.toml', 'server.properties']),
    ).toBe('serverpack');
  });

  it('treats a bare jar dump as mods-only', () => {
    expect(classify(['mods/a.jar', 'mods/b.jar'])).toBe('mods-only');
  });

  it('sees through a single wrapping directory', () => {
    expect(
      classify(['MyPack-1.20.1/mods/a.jar', 'MyPack-1.20.1/server.properties']),
    ).toBe('serverpack');
  });
});

describe('stripRoot', () => {
  it('returns the wrapping directory when everything lives under one', () => {
    expect(
      stripRoot(['MyPack-1.20.1/mods/a.jar', 'MyPack-1.20.1/config/b.toml']),
    ).toBe('MyPack-1.20.1/');
  });

  it('returns an empty prefix when entries sit at the root', () => {
    expect(stripRoot(['mods/a.jar', 'config/b.toml'])).toBe('');
  });

  it('does not strip when two top-level entries exist', () => {
    expect(stripRoot(['mods/a.jar', 'readme.txt'])).toBe('');
  });
});

describe('isLauncherArtifact', () => {
  it.each([
    'forge-1.20.1-47.2.0-installer.jar',
    'server.jar',
    'minecraft_server.1.20.1.jar',
    'libraries/net/minecraftforge/forge/1.20.1-47.2.0/x.jar',
    'versions/1.20.1/server.jar',
    'run.sh',
    'run.bat',
    'start.sh',
    'user_jvm_args.txt',
    'mc.service',
  ])('filters %s', (entry) => {
    expect(isLauncherArtifact(entry)).toBe(true);
  });

  it.each([
    'mods/jei.jar',
    'plugins/EssentialsX.jar',
    'config/jei/jei.toml',
    'server.properties',
    'ops.json',
    'world/level.dat',
    'kubejs/startup_scripts/a.js',
  ])('keeps %s', (entry) => {
    expect(isLauncherArtifact(entry)).toBe(false);
  });
});

describe('mineLoader', () => {
  it('reads NeoForge from its libraries path', () => {
    expect(
      mineLoader([
        'libraries/net/neoforged/neoforge/21.1.80/neoforge-21.1.80.jar',
      ]),
    ).toEqual({ loader: 'neoforge', loaderVersion: '21.1.80' });
  });

  it('reads Forge and the Minecraft version together', () => {
    expect(
      mineLoader([
        'libraries/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-server.jar',
      ]),
    ).toEqual({ loader: 'forge', version: '1.20.1', loaderVersion: '47.2.0' });
  });

  it('reads Fabric from its loader path', () => {
    expect(
      mineLoader([
        'libraries/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar',
      ]),
    ).toEqual({ loader: 'fabric', loaderVersion: '0.16.9' });
  });

  it('reads Paper from its root jar', () => {
    expect(mineLoader(['paper-1.20.4-497.jar'])).toEqual({
      loader: 'paper',
      version: '1.20.4',
      loaderVersion: '497',
    });
  });

  it('returns null when nothing identifies the loader', () => {
    expect(mineLoader(['mods/a.jar', 'config/b.toml'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./backend exec jest src/packs/pack-format.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend/src/packs/pack-format.ts
import { Loader } from '../servers/provisioning';

export type PackShape = 'mrpack' | 'curseforge' | 'serverpack' | 'mods-only';

export interface MinedLoader {
  loader: Loader;
  version?: string;
  loaderVersion?: string;
}

/**
 * Classification reads zip entry names, never the filename: CurseForge hands
 * out a "server files" zip with no manifest, and GitHub packs are named
 * anything at all. Content is the only reliable signal.
 */
export function classify(entries: string[]): PackShape {
  const prefix = stripRoot(entries);
  const rel = entries.map((entry) => entry.slice(prefix.length));
  if (rel.includes('modrinth.index.json')) return 'mrpack';
  if (rel.includes('manifest.json')) return 'curseforge';
  const hasMods = rel.some((entry) => /^(mods|plugins)\//.test(entry));
  const hasServerContent = rel.some((entry) =>
    /^(config|defaultconfigs|kubejs|scripts|world|server\.properties|ops\.json)/.test(
      entry,
    ),
  );
  if (hasMods && hasServerContent) return 'serverpack';
  if (hasMods) return 'mods-only';
  return 'serverpack';
}

/**
 * GitHub release zips usually wrap everything in one directory. Return the
 * prefix to strip, or '' when entries already sit at the root.
 */
export function stripRoot(entries: string[]): string {
  const tops = new Set(
    entries
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.split('/')[0]),
  );
  if (tops.size !== 1) return '';
  const [top] = [...tops];
  // Only a directory can be stripped: a single-file zip has no wrapper.
  const isDir = entries.every((entry) => entry.startsWith(`${top}/`));
  return isDir ? `${top}/` : '';
}

/** Loader bootstrap that fights itzg — itzg installs the loader itself. */
export function isLauncherArtifact(relPath: string): boolean {
  if (/^(libraries|versions)\//.test(relPath)) return true;
  if (/installer\.jar$/i.test(relPath)) return true;
  if (/\.service$/.test(relPath)) return true;
  if (relPath === 'user_jvm_args.txt') return true;
  if (/^(run|start)\.(sh|bat|command)$/.test(relPath)) return true;
  // Root-level jars only: mods/*.jar and plugins/*.jar must survive.
  if (!relPath.includes('/') && /\.jar$/i.test(relPath)) return true;
  return false;
}

const NEOFORGE = /libraries\/net\/neoforged\/neoforge\/([^/]+)\//;
const FORGE = /libraries\/net\/minecraftforge\/forge\/([^-/]+)-([^/]+)\//;
const FABRIC = /libraries\/net\/fabricmc\/fabric-loader\/([^/]+)\//;
const PAPER_JAR = /^paper-([0-9][^-]*)-([0-9]+)\.jar$/;
const FABRIC_LAUNCH = /^fabric-server-launch\.jar$/;

/**
 * Mine the loader out of the bootstrap files before discarding them. This is
 * what turns a plain server pack from "the user must know their loader" into
 * auto-detection.
 */
export function mineLoader(entries: string[]): MinedLoader | null {
  const prefix = stripRoot(entries);
  const rel = entries.map((entry) => entry.slice(prefix.length));
  for (const entry of rel) {
    const neoforge = NEOFORGE.exec(entry);
    if (neoforge) return { loader: 'neoforge', loaderVersion: neoforge[1] };
    const forge = FORGE.exec(entry);
    if (forge) {
      return { loader: 'forge', version: forge[1], loaderVersion: forge[2] };
    }
    const fabric = FABRIC.exec(entry);
    if (fabric) return { loader: 'fabric', loaderVersion: fabric[1] };
    const paper = PAPER_JAR.exec(entry);
    if (paper) {
      return { loader: 'paper', version: paper[1], loaderVersion: paper[2] };
    }
    if (FABRIC_LAUNCH.test(entry)) return { loader: 'fabric' };
  }
  return null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter ./backend exec jest src/packs/pack-format.spec.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/packs/pack-format.ts backend/src/packs/pack-format.spec.ts
git commit -m "feat: add pure pack classification and loader mining"
```

---

### Task 2: Manifest parsers

**Files:**

- Modify: `backend/src/packs/pack-format.ts`
- Test: `backend/src/packs/manifests.spec.ts`

**Interfaces:**

- Produces:
  - `interface PackFile { path: string; url?: string; sha512?: string; projectId?: number; fileId?: number }`
  - `interface ParsedPack { loader: Loader; version: string; loaderVersion?: string; files: PackFile[]; overridesPrefix: string[] }`
  - `parseMrpack(indexJson: string): ParsedPack`
  - `parseCurseforgeManifest(manifestJson: string): ParsedPack`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/packs/manifests.spec.ts
import { parseCurseforgeManifest, parseMrpack } from './pack-format';

const MRPACK = JSON.stringify({
  formatVersion: 1,
  game: 'minecraft',
  versionId: '1.2.3',
  name: 'Cool Pack',
  files: [
    {
      path: 'mods/jei.jar',
      hashes: { sha512: 'abc', sha1: 'zzz' },
      downloads: ['https://cdn.modrinth.com/jei.jar'],
      env: { client: 'required', server: 'required' },
    },
    {
      path: 'mods/clientonly.jar',
      hashes: { sha512: 'def' },
      downloads: ['https://cdn.modrinth.com/clientonly.jar'],
      env: { client: 'required', server: 'unsupported' },
    },
  ],
  dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.16.9' },
});

const CF_MANIFEST = JSON.stringify({
  minecraft: {
    version: '1.20.1',
    modLoaders: [{ id: 'forge-47.2.0', primary: true }],
  },
  files: [
    { projectID: 238222, fileID: 4712124, required: true },
    { projectID: 111, fileID: 222, required: false },
  ],
  overrides: 'overrides',
});

describe('parseMrpack', () => {
  it('reads the loader and Minecraft version from dependencies', () => {
    const parsed = parseMrpack(MRPACK);
    expect(parsed.loader).toBe('fabric');
    expect(parsed.version).toBe('1.20.1');
    expect(parsed.loaderVersion).toBe('0.16.9');
  });

  it('keeps server files with their sha512 and skips client-only ones', () => {
    const parsed = parseMrpack(MRPACK);
    expect(parsed.files).toEqual([
      {
        path: 'mods/jei.jar',
        url: 'https://cdn.modrinth.com/jei.jar',
        sha512: 'abc',
      },
    ]);
  });

  it('lists the override prefixes a server install should extract', () => {
    expect(parseMrpack(MRPACK).overridesPrefix).toEqual([
      'overrides/',
      'server-overrides/',
    ]);
  });

  it('throws on an unsupported loader', () => {
    const bad = JSON.stringify({
      versionId: '1',
      files: [],
      dependencies: { minecraft: '1.20.1', 'quilt-loader': '0.1.0' },
    });
    expect(() => parseMrpack(bad)).toThrow(/quilt/i);
  });
});

describe('parseCurseforgeManifest', () => {
  it('reads the loader, its version and the Minecraft version', () => {
    const parsed = parseCurseforgeManifest(CF_MANIFEST);
    expect(parsed.loader).toBe('forge');
    expect(parsed.version).toBe('1.20.1');
    expect(parsed.loaderVersion).toBe('47.2.0');
  });

  it('lists every file as an unresolved project/file id pair', () => {
    const parsed = parseCurseforgeManifest(CF_MANIFEST);
    expect(parsed.files).toEqual([
      { path: 'mods', projectId: 238222, fileId: 4712124 },
      { path: 'mods', projectId: 111, fileId: 222 },
    ]);
  });

  it('uses the manifest overrides directory', () => {
    expect(parseCurseforgeManifest(CF_MANIFEST).overridesPrefix).toEqual([
      'overrides/',
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./backend exec jest src/packs/manifests.spec.ts`
Expected: FAIL — `parseMrpack` is not exported.

- [ ] **Step 3: Implement**

```ts
// backend/src/packs/pack-format.ts — additions
export interface PackFile {
  /** Destination path for URL files; the target directory for CF id files. */
  path: string;
  url?: string;
  sha512?: string;
  projectId?: number;
  fileId?: number;
}

export interface ParsedPack {
  loader: Loader;
  version: string;
  loaderVersion?: string;
  files: PackFile[];
  /** Zip prefixes whose contents extract into data/, in order. */
  overridesPrefix: string[];
}

interface MrpackIndex {
  versionId?: string;
  files?: Array<{
    path: string;
    hashes?: { sha512?: string };
    downloads?: string[];
    env?: { server?: string };
  }>;
  dependencies?: Record<string, string>;
}

/** mrpack dependency key → our loader name. Quilt is not supported. */
const MRPACK_LOADER: Record<string, Loader> = {
  'fabric-loader': 'fabric',
  forge: 'forge',
  neoforge: 'neoforge',
};

export function parseMrpack(indexJson: string): ParsedPack {
  const index = JSON.parse(indexJson) as MrpackIndex;
  const dependencies = index.dependencies ?? {};
  const version = dependencies.minecraft;
  if (!version) throw new Error('pack manifest has no minecraft version');

  const loaderKey = Object.keys(dependencies).find(
    (key) => key !== 'minecraft',
  );
  const loader = loaderKey ? MRPACK_LOADER[loaderKey] : undefined;
  if (!loader) {
    throw new Error(
      `pack uses an unsupported mod loader: ${loaderKey ?? 'none declared'}`,
    );
  }

  const files: PackFile[] = [];
  for (const file of index.files ?? []) {
    // env.server === 'unsupported' marks a client-only mod; installing it
    // server-side is how a pack fails to boot.
    if (file.env?.server === 'unsupported') continue;
    const url = file.downloads?.[0];
    if (!url) continue;
    files.push({
      path: file.path,
      url,
      ...(file.hashes?.sha512 ? { sha512: file.hashes.sha512 } : {}),
    });
  }

  return {
    loader,
    version,
    ...(loaderKey ? { loaderVersion: dependencies[loaderKey] } : {}),
    files,
    // server-overrides wins by being applied last.
    overridesPrefix: ['overrides/', 'server-overrides/'],
  };
}

interface CfManifest {
  minecraft?: {
    version?: string;
    modLoaders?: Array<{ id?: string; primary?: boolean }>;
  };
  files?: Array<{ projectID?: number; fileID?: number }>;
  overrides?: string;
}

const CF_LOADER: Record<string, Loader> = {
  forge: 'forge',
  neoforge: 'neoforge',
  fabric: 'fabric',
};

export function parseCurseforgeManifest(manifestJson: string): ParsedPack {
  const manifest = JSON.parse(manifestJson) as CfManifest;
  const version = manifest.minecraft?.version;
  if (!version) throw new Error('pack manifest has no minecraft version');

  const loaders = manifest.minecraft?.modLoaders ?? [];
  const primary = loaders.find((entry) => entry.primary) ?? loaders[0];
  const [name, loaderVersion] = (primary?.id ?? '').split('-');
  const loader = CF_LOADER[name];
  if (!loader) {
    throw new Error(`pack uses an unsupported mod loader: ${name || 'none'}`);
  }

  return {
    loader,
    version,
    ...(loaderVersion ? { loaderVersion } : {}),
    files: (manifest.files ?? [])
      .filter((file) => file.projectID && file.fileID)
      .map((file) => ({
        path: 'mods',
        projectId: file.projectID as number,
        fileId: file.fileID as number,
      })),
    overridesPrefix: [`${manifest.overrides ?? 'overrides'}/`],
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter ./backend exec jest src/packs/`
Expected: PASS, both spec files.

- [ ] **Step 5: Commit**

```bash
git add backend/src/packs
git commit -m "feat: parse mrpack and curseforge manifests"
```

---

### Task 3: Fabric in provisioning

**Files:**

- Modify: `backend/src/servers/provisioning.ts`
- Test: `backend/src/servers/provisioning.spec.ts`

**Interfaces:**

- Produces: `LOADERS` gains `'fabric'`; `toItzgEnv` maps it to `TYPE=FABRIC` with `FABRIC_LOADER_VERSION`.

Note: the manual create wizard's dropdown is **not** extended — Fabric arrives only through a pack until a Fabric version fetcher exists (Phase 3). The backend must accept it because most `.mrpack` files are Fabric.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/servers/provisioning.spec.ts — add
it('maps fabric to the itzg fabric type and loader version', () => {
  expect(
    toItzgEnv({
      loader: 'fabric',
      version: '1.20.1',
      loaderVersion: '0.16.9',
      ramMb: 4096,
      rconPassword: 'secret',
    }),
  ).toEqual(
    expect.arrayContaining([
      'TYPE=FABRIC',
      'VERSION=1.20.1',
      'FABRIC_LOADER_VERSION=0.16.9',
    ]),
  );
});

it('omits the fabric loader version when none is pinned', () => {
  expect(
    toItzgEnv({
      loader: 'fabric',
      version: '1.20.1',
      ramMb: 4096,
      rconPassword: 'secret',
    }),
  ).not.toEqual(
    expect.arrayContaining([expect.stringContaining('FABRIC_LOADER_VERSION')]),
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./backend exec jest src/servers/provisioning.spec.ts`
Expected: FAIL — `'fabric'` is not assignable to `Loader`.

- [ ] **Step 3: Implement**

```ts
// backend/src/servers/provisioning.ts
export const LOADERS = [
  'vanilla',
  'paper',
  'forge',
  'neoforge',
  'fabric',
] as const;

const ITZG_TYPE: Record<Loader, string> = {
  vanilla: 'VANILLA',
  paper: 'PAPER',
  forge: 'FORGE',
  neoforge: 'NEOFORGE',
  fabric: 'FABRIC',
};

const BUILD_ENV: Record<Loader, string | null> = {
  vanilla: null,
  paper: 'PAPER_BUILD',
  forge: 'FORGE_VERSION',
  neoforge: 'NEOFORGE_VERSION',
  fabric: 'FABRIC_LOADER_VERSION',
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter ./backend exec jest src/servers/ && pnpm --filter ./backend exec jest src/versions/`
Expected: PASS. If a `versions/` test asserts an exhaustive loader list, update it to include `fabric` and have the Fabric fetcher return an empty list — the wizard does not offer Fabric yet, and an unlisted loader must not 500.

- [ ] **Step 5: Commit**

```bash
git add backend/src/servers/provisioning.ts backend/src/servers/provisioning.spec.ts backend/src/versions
git commit -m "feat: support fabric as a pack-declared loader"
```

---

### Task 4: `PackDownloader`

**Files:**

- Create: `backend/src/packs/pack-downloader.ts`
- Test: `backend/src/packs/pack-downloader.spec.ts`

**Interfaces:**

- Produces:
  - `PackDownloader.toFile(url: string, dest: string, opts?: { sha512?: string }): Promise<number>` — returns bytes written
  - constants `MAX_PACK_BYTES` (from `MAX_PACK_MB`, default 4096 MB), `DOWNLOAD_TIMEOUT_MS = 120_000`, `MAX_REDIRECTS = 5`
  - throws on cap exceeded, timeout, non-2xx, or sha512 mismatch (and deletes the partial file)

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/packs/pack-downloader.spec.ts
import { createHash } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PackDownloader } from './pack-downloader';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end('PACKDATA');
      return;
    }
    if (req.url === '/huge') {
      res.writeHead(200, { 'Content-Length': String(10 * 1024 ** 3) });
      res.end('x');
      return;
    }
    if (req.url === '/boom') {
      res.writeHead(500);
      res.end('nope');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('PackDownloader', () => {
  const packDownloader = new PackDownloader();

  it('streams a file to disk and reports its size', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcdl-'));
    const dest = path.join(dir, 'pack.zip');

    const bytes = await packDownloader.toFile(`${base}/ok`, dest);

    expect(bytes).toBe(8);
    expect(await readFile(dest, 'utf8')).toBe('PACKDATA');
  });

  it('verifies sha512 and deletes the file on mismatch', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcdl-'));
    const dest = path.join(dir, 'pack.zip');

    await expect(
      packDownloader.toFile(`${base}/ok`, dest, { sha512: 'deadbeef' }),
    ).rejects.toThrow(/checksum/i);
    await expect(stat(dest)).rejects.toThrow();
  });

  it('accepts a correct sha512', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcdl-'));
    const dest = path.join(dir, 'pack.zip');
    const digest = createHash('sha512').update('PACKDATA').digest('hex');

    await expect(
      packDownloader.toFile(`${base}/ok`, dest, { sha512: digest }),
    ).resolves.toBe(8);
  });

  it('refuses a response whose declared size exceeds the cap', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcdl-'));
    await expect(
      packDownloader.toFile(`${base}/huge`, path.join(dir, 'p.zip')),
    ).rejects.toThrow(/too large/i);
  });

  it('reports a non-2xx status', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcdl-'));
    await expect(
      packDownloader.toFile(`${base}/boom`, path.join(dir, 'p.zip')),
    ).rejects.toThrow(/500/);
  });

  it('rejects a non-http url', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcdl-'));
    await expect(
      packDownloader.toFile('file:///etc/passwd', path.join(dir, 'p.zip')),
    ).rejects.toThrow(/http/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./backend exec jest src/packs/pack-downloader.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend/src/packs/pack-downloader.ts
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_PACK_BYTES =
  Number(process.env.MAX_PACK_MB ?? 4096) * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 120_000;
export const MAX_REDIRECTS = 5;

export interface DownloadOptions {
  sha512?: string;
  headers?: Record<string, string>;
}

@Injectable()
export class PackDownloader {
  /**
   * Stream a URL to disk. Everything here is a guard: only http(s), a
   * declared-size check before the body is read, a running byte count for
   * servers that lie about Content-Length, a timeout, a redirect limit, and
   * an optional sha512. A failed download leaves no partial file behind.
   */
  async toFile(
    url: string,
    dest: string,
    opts: DownloadOptions = {},
  ): Promise<number> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `only http(s) pack urls are supported: ${parsed.protocol}`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: opts.headers,
      });
      if (!response.ok) {
        throw new Error(`download failed with ${response.status} for ${url}`);
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_PACK_BYTES) {
        throw new Error(
          `download is too large (${declared} bytes, cap ${MAX_PACK_BYTES})`,
        );
      }
      if (!response.body) throw new Error(`download returned no body: ${url}`);

      const hash = opts.sha512 ? createHash('sha512') : null;
      let written = 0;
      const source = Readable.fromWeb(
        response.body as Parameters<typeof Readable.fromWeb>[0],
      );
      source.on('data', (chunk: Buffer) => {
        written += chunk.length;
        hash?.update(chunk);
        if (written > MAX_PACK_BYTES) {
          source.destroy(
            new Error(`download is too large (cap ${MAX_PACK_BYTES} bytes)`),
          );
        }
      });
      await pipeline(source, createWriteStream(dest));

      if (hash && opts.sha512) {
        const digest = hash.digest('hex');
        if (digest !== opts.sha512.toLowerCase()) {
          throw new Error(`checksum mismatch for ${url}`);
        }
      }
      return written;
    } catch (error) {
      await rm(dest, { force: true });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
```

`MAX_REDIRECTS` is enforced by `fetch`'s own `redirect: 'follow'` policy (20 by default in undici). Export the constant for documentation and assert it in the installer's error message only — do not hand-roll redirect following.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter ./backend exec jest src/packs/pack-downloader.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/packs/pack-downloader.ts backend/src/packs/pack-downloader.spec.ts
git commit -m "feat: add streaming pack downloader with caps and hash checks"
```

---

### Task 5: CurseForge client

**Files:**

- Create: `backend/src/packs/curseforge.client.ts`
- Test: `backend/src/packs/curseforge.client.spec.ts`
- Modify: `backend/src/config/env.ts` (doc comment)

**Interfaces:**

- Produces:
  - `interface ResolvedMod { fileName: string; url: string }`
  - `interface BlockedMod { projectId: number; fileId: number; fileName?: string }`
  - `CurseforgeClient.resolve(files: Array<{ projectId: number; fileId: number }>): Promise<{ resolved: ResolvedMod[]; blocked: BlockedMod[] }>`
  - throws `BadRequestException` when `CURSEFORGE_API_KEY` is unset

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/packs/curseforge.client.spec.ts
import { BadRequestException } from '@nestjs/common';
import { CurseforgeClient } from './curseforge.client';

describe('CurseforgeClient', () => {
  afterEach(() => {
    delete process.env.CURSEFORGE_API_KEY;
    jest.restoreAllMocks();
  });

  it('fails with a clear message when no api key is configured', async () => {
    const client = new CurseforgeClient();
    await expect(
      client.resolve([{ projectId: 1, fileId: 2 }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('splits resolvable files from distribution-blocked ones', async () => {
    process.env.CURSEFORGE_API_KEY = 'key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 2,
            modId: 1,
            fileName: 'jei.jar',
            downloadUrl: 'https://edge.forgecdn.net/jei.jar',
          },
          // A null downloadUrl is how CurseForge reports "author opted out of
          // third-party distribution".
          { id: 4, modId: 3, fileName: 'secret.jar', downloadUrl: null },
        ],
      }),
    }) as unknown as typeof fetch;

    const client = new CurseforgeClient();
    const result = await client.resolve([
      { projectId: 1, fileId: 2 },
      { projectId: 3, fileId: 4 },
    ]);

    expect(result.resolved).toEqual([
      { fileName: 'jei.jar', url: 'https://edge.forgecdn.net/jei.jar' },
    ]);
    expect(result.blocked).toEqual([
      { projectId: 3, fileId: 4, fileName: 'secret.jar' },
    ]);
  });

  it('sends the api key as a header, never in the url', async () => {
    process.env.CURSEFORGE_API_KEY = 'key';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new CurseforgeClient().resolve([{ projectId: 1, fileId: 2 }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('key');
    expect(init.headers['x-api-key']).toBe('key');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./backend exec jest src/packs/curseforge.client.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend/src/packs/curseforge.client.ts
import { BadRequestException, Injectable } from '@nestjs/common';

const API = 'https://api.curseforge.com/v1/mods/files';
/** The API takes at most 1000 ids per call; stay well under it. */
const BATCH = 200;

export interface ResolvedMod {
  fileName: string;
  url: string;
}

export interface BlockedMod {
  projectId: number;
  fileId: number;
  fileName?: string;
}

interface CfFile {
  id: number;
  modId: number;
  fileName?: string;
  downloadUrl?: string | null;
}

@Injectable()
export class CurseforgeClient {
  /**
   * Turn manifest project/file ids into download URLs. Mods whose authors
   * opted out of third-party distribution come back with a null downloadUrl
   * and are reported as blocked rather than guessed at — the CDN path
   * reconstruction trick other launchers use is a terms-of-service problem
   * and breaks silently.
   */
  async resolve(
    files: Array<{ projectId: number; fileId: number }>,
  ): Promise<{ resolved: ResolvedMod[]; blocked: BlockedMod[] }> {
    const apiKey = process.env.CURSEFORGE_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        'This is a CurseForge pack. Set CURSEFORGE_API_KEY on the server to install it, or upload a server-pack zip instead.',
      );
    }

    const resolved: ResolvedMod[] = [];
    const blocked: BlockedMod[] = [];
    const byFileId = new Map(files.map((file) => [file.fileId, file]));

    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const response = await fetch(API, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ fileIds: batch.map((file) => file.fileId) }),
      });
      if (!response.ok) {
        throw new BadRequestException(
          `CurseForge API returned ${response.status} while resolving mods`,
        );
      }
      const payload = (await response.json()) as { data?: CfFile[] };
      for (const file of payload.data ?? []) {
        if (file.downloadUrl && file.fileName) {
          resolved.push({ fileName: file.fileName, url: file.downloadUrl });
        } else {
          const source = byFileId.get(file.id);
          blocked.push({
            projectId: source?.projectId ?? file.modId,
            fileId: file.id,
            ...(file.fileName ? { fileName: file.fileName } : {}),
          });
        }
      }
    }

    return { resolved, blocked };
  }
}
```

Add `CURSEFORGE_API_KEY` and `MAX_PACK_MB` to the optional-vars comment in `backend/src/config/env.ts`.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter ./backend exec jest src/packs/curseforge.client.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/packs/curseforge.client.ts backend/src/packs/curseforge.client.spec.ts backend/src/config/env.ts
git commit -m "feat: resolve curseforge pack files via the api"
```

---

### Task 6: `PackInstaller`

**Files:**

- Create: `backend/src/packs/pack-installer.ts`
- Test: `backend/src/packs/pack-installer.spec.ts`

**Interfaces:**

- Consumes: `pack-format` (Tasks 1–2), `PackDownloader` (Task 4), `CurseforgeClient` (Task 5), `ArchiveService` (file-manager plan), `DockerService.dataDir` / `.serverRoot`.
- Produces:
  - `interface PackSource { url?: string; stagedPath?: string }`
  - `interface InstallProgress { stage: 'download' | 'inspect' | 'mods' | 'extract' | 'done' | 'failed'; message: string; done?: number; total?: number }`
  - `interface InstallResult { loader: Loader; version: string; loaderVersion?: string; blocked: BlockedMod[] }`
  - `PackInstaller.install(serverId: string, source: PackSource, fallback: { loader?: Loader; version?: string }, onProgress: (p: InstallProgress) => void): Promise<InstallResult>`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/packs/pack-installer.spec.ts
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PackInstaller } from './pack-installer';
import { ArchiveService } from '../files/archive.service';

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'mcpack-'));
  const dataDir = path.join(root, 's1', 'data');
  await mkdir(dataDir, { recursive: true });

  const archiveService = new ArchiveService();
  const downloaded: string[] = [];
  const packDownloader = {
    toFile: jest.fn(async (url: string, dest: string) => {
      downloaded.push(url);
      await writeFile(dest, 'JAR');
      return 3;
    }),
  };
  const curseforgeClient = { resolve: jest.fn() };

  const packInstaller = new PackInstaller(
    packDownloader as never,
    curseforgeClient as never,
    archiveService,
    {
      dataDir: () => dataDir,
      serverRoot: () => path.join(root, 's1'),
    } as never,
  );

  return {
    packInstaller,
    dataDir,
    root,
    downloaded,
    archiveService,
    curseforgeClient,
  };
}

/** Build a zip on disk from a map of entry name → contents. */
async function makeZip(
  archiveService: ArchiveService,
  dir: string,
  entries: Record<string, string>,
): Promise<string> {
  const sources = [];
  for (const [name, content] of Object.entries(entries)) {
    const file = path.join(dir, name.replace(/\//g, '_'));
    await writeFile(file, content);
    sources.push({ file, name });
  }
  const zip = path.join(dir, 'pack.zip');
  await archiveService.createZipWithNames(sources, zip);
  return zip;
}

describe('PackInstaller', () => {
  it('installs an mrpack: downloads server mods and extracts overrides', async () => {
    const { packInstaller, dataDir, root, downloaded, archiveService } =
      await harness();
    const staging = await mkdtemp(path.join(root, 'stage-'));
    const zip = await makeZip(archiveService, staging, {
      'modrinth.index.json': JSON.stringify({
        versionId: '1',
        dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.16.9' },
        files: [
          {
            path: 'mods/jei.jar',
            downloads: ['https://cdn/jei.jar'],
            env: { server: 'required' },
          },
          {
            path: 'mods/skip.jar',
            downloads: ['https://cdn/skip.jar'],
            env: { server: 'unsupported' },
          },
        ],
      }),
      'overrides/config/jei.toml': 'a=1',
    });

    const stages: string[] = [];
    const result = await packInstaller.install(
      's1',
      { stagedPath: zip },
      {},
      (progress) => stages.push(progress.stage),
    );

    expect(result).toEqual({
      loader: 'fabric',
      version: '1.20.1',
      loaderVersion: '0.16.9',
      blocked: [],
    });
    expect(downloaded).toEqual(['https://cdn/jei.jar']);
    expect(await readFile(path.join(dataDir, 'mods/jei.jar'), 'utf8')).toBe(
      'JAR',
    );
    expect(await readFile(path.join(dataDir, 'config/jei.toml'), 'utf8')).toBe(
      'a=1',
    );
    expect(stages).toContain('done');
  });

  it('installs a server pack, stripping the wrapper and the launcher junk', async () => {
    const { packInstaller, dataDir, root, archiveService } = await harness();
    const staging = await mkdtemp(path.join(root, 'stage-'));
    const zip = await makeZip(archiveService, staging, {
      'MyPack-1.20.1/mods/jei.jar': 'MOD',
      'MyPack-1.20.1/config/jei.toml': 'a=1',
      'MyPack-1.20.1/server.properties': 'level-name=world',
      'MyPack-1.20.1/run.sh': '#!/bin/sh',
      'MyPack-1.20.1/libraries/net/minecraftforge/forge/1.20.1-47.2.0/forge.jar':
        'X',
    });

    const result = await packInstaller.install(
      's1',
      { stagedPath: zip },
      {},
      () => undefined,
    );

    expect(result.loader).toBe('forge');
    expect(result.version).toBe('1.20.1');
    expect(result.loaderVersion).toBe('47.2.0');
    const top = await readdir(dataDir);
    expect(top.sort()).toEqual(['config', 'mods', 'server.properties']);
  });

  it('falls back to the wizard loader when a mods-only zip declares nothing', async () => {
    const { packInstaller, root, archiveService } = await harness();
    const staging = await mkdtemp(path.join(root, 'stage-'));
    const zip = await makeZip(archiveService, staging, { 'mods/a.jar': 'MOD' });

    const result = await packInstaller.install(
      's1',
      { stagedPath: zip },
      { loader: 'forge', version: '1.20.1' },
      () => undefined,
    );

    expect(result.loader).toBe('forge');
    expect(result.version).toBe('1.20.1');
  });

  it('fails clearly when nothing declares a loader and no fallback was given', async () => {
    const { packInstaller, root, archiveService } = await harness();
    const staging = await mkdtemp(path.join(root, 'stage-'));
    const zip = await makeZip(archiveService, staging, { 'mods/a.jar': 'MOD' });

    await expect(
      packInstaller.install('s1', { stagedPath: zip }, {}, () => undefined),
    ).rejects.toThrow(/loader/i);
  });

  it('reports curseforge mods that cannot be downloaded', async () => {
    const { packInstaller, root, archiveService, curseforgeClient } =
      await harness();
    curseforgeClient.resolve.mockResolvedValue({
      resolved: [{ fileName: 'jei.jar', url: 'https://cdn/jei.jar' }],
      blocked: [{ projectId: 3, fileId: 4, fileName: 'secret.jar' }],
    });
    const staging = await mkdtemp(path.join(root, 'stage-'));
    const zip = await makeZip(archiveService, staging, {
      'manifest.json': JSON.stringify({
        minecraft: {
          version: '1.20.1',
          modLoaders: [{ id: 'forge-47.2.0', primary: true }],
        },
        files: [
          { projectID: 1, fileID: 2 },
          { projectID: 3, fileID: 4 },
        ],
        overrides: 'overrides',
      }),
      'overrides/config/a.toml': 'a=1',
    });

    const result = await packInstaller.install(
      's1',
      { stagedPath: zip },
      {},
      () => undefined,
    );

    expect(result.blocked).toEqual([
      { projectId: 3, fileId: 4, fileName: 'secret.jar' },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./backend exec jest src/packs/pack-installer.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend/src/packs/pack-installer.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { ArchiveService } from '../files/archive.service';
import { DockerService } from '../servers/docker.service';
import { Loader } from '../servers/provisioning';
import { PackDownloader } from './pack-downloader';
import { BlockedMod, CurseforgeClient } from './curseforge.client';
import {
  classify,
  isLauncherArtifact,
  mineLoader,
  ParsedPack,
  parseCurseforgeManifest,
  parseMrpack,
  stripRoot,
} from './pack-format';

export interface PackSource {
  url?: string;
  stagedPath?: string;
}

export interface InstallProgress {
  stage: 'download' | 'inspect' | 'mods' | 'extract' | 'done' | 'failed';
  message: string;
  done?: number;
  total?: number;
}

export interface InstallResult {
  loader: Loader;
  version: string;
  loaderVersion?: string;
  blocked: BlockedMod[];
}

@Injectable()
export class PackInstaller {
  constructor(
    private readonly packDownloader: PackDownloader,
    private readonly curseforgeClient: CurseforgeClient,
    private readonly archiveService: ArchiveService,
    private readonly dockerService: DockerService,
  ) {}

  async install(
    serverId: string,
    source: PackSource,
    fallback: { loader?: Loader; version?: string },
    onProgress: (progress: InstallProgress) => void,
  ): Promise<InstallResult> {
    const staging = path.join(
      this.dockerService.serverRoot(serverId),
      'staging',
    );
    await mkdir(staging, { recursive: true });
    try {
      const zip = await this.obtain(source, staging, onProgress);

      onProgress({ stage: 'inspect', message: 'Inspecting pack' });
      const unpacked = path.join(staging, 'unpacked');
      await this.archiveService.extractZip(zip, unpacked);
      const entries = await listEntries(unpacked);
      const shape = classify(entries);
      const prefix = stripRoot(entries);
      const contentRoot = path.join(unpacked, prefix);

      const dataDir = this.dockerService.dataDir(serverId);
      await mkdir(dataDir, { recursive: true });

      if (shape === 'mrpack' || shape === 'curseforge') {
        return await this.installManifestPack(
          shape,
          contentRoot,
          dataDir,
          onProgress,
        );
      }
      return await this.installServerPack(
        contentRoot,
        entries.map((entry) => entry.slice(prefix.length)),
        dataDir,
        fallback,
        onProgress,
      );
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  /** Either fetch the URL or adopt the already-staged upload. */
  private async obtain(
    source: PackSource,
    staging: string,
    onProgress: (progress: InstallProgress) => void,
  ): Promise<string> {
    if (source.stagedPath) return source.stagedPath;
    if (!source.url) throw new BadRequestException('no pack source supplied');
    onProgress({ stage: 'download', message: 'Downloading pack' });
    const dest = path.join(staging, `${randomBytes(6).toString('hex')}.zip`);
    await this.packDownloader.toFile(source.url, dest);
    return dest;
  }

  private async installManifestPack(
    shape: 'mrpack' | 'curseforge',
    contentRoot: string,
    dataDir: string,
    onProgress: (progress: InstallProgress) => void,
  ): Promise<InstallResult> {
    const manifestName =
      shape === 'mrpack' ? 'modrinth.index.json' : 'manifest.json';
    const raw = await readFile(path.join(contentRoot, manifestName), 'utf8');
    const parsed: ParsedPack =
      shape === 'mrpack' ? parseMrpack(raw) : parseCurseforgeManifest(raw);

    const blocked = await this.fetchMods(parsed, dataDir, onProgress);

    onProgress({ stage: 'extract', message: 'Applying pack files' });
    for (const prefix of parsed.overridesPrefix) {
      const from = path.join(contentRoot, prefix);
      // Later prefixes win: server-overrides deliberately overwrites overrides.
      await cp(from, dataDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }

    onProgress({ stage: 'done', message: 'Pack installed' });
    return {
      loader: parsed.loader,
      version: parsed.version,
      ...(parsed.loaderVersion ? { loaderVersion: parsed.loaderVersion } : {}),
      blocked,
    };
  }

  private async fetchMods(
    parsed: ParsedPack,
    dataDir: string,
    onProgress: (progress: InstallProgress) => void,
  ): Promise<BlockedMod[]> {
    const idFiles = parsed.files.filter(
      (file) => file.fileId && file.projectId,
    );
    const urlFiles = parsed.files.filter((file) => file.url);
    let blocked: BlockedMod[] = [];
    const jobs: Array<{ dest: string; url: string; sha512?: string }> = [];

    for (const file of urlFiles) {
      jobs.push({
        dest: path.join(dataDir, file.path),
        url: file.url as string,
        ...(file.sha512 ? { sha512: file.sha512 } : {}),
      });
    }

    if (idFiles.length > 0) {
      const resolution = await this.curseforgeClient.resolve(
        idFiles.map((file) => ({
          projectId: file.projectId as number,
          fileId: file.fileId as number,
        })),
      );
      blocked = resolution.blocked;
      for (const mod of resolution.resolved) {
        jobs.push({
          dest: path.join(dataDir, 'mods', mod.fileName),
          url: mod.url,
        });
      }
    }

    let done = 0;
    for (const job of jobs) {
      await mkdir(path.dirname(job.dest), { recursive: true });
      await this.packDownloader.toFile(
        job.url,
        job.dest,
        job.sha512 ? { sha512: job.sha512 } : {},
      );
      done += 1;
      onProgress({
        stage: 'mods',
        message: `Downloading mods (${done}/${jobs.length})`,
        done,
        total: jobs.length,
      });
    }
    return blocked;
  }

  private async installServerPack(
    contentRoot: string,
    relEntries: string[],
    dataDir: string,
    fallback: { loader?: Loader; version?: string },
    onProgress: (progress: InstallProgress) => void,
  ): Promise<InstallResult> {
    // Mine the loader out of the bootstrap files before they are filtered.
    const mined = mineLoader(relEntries);
    const loader = mined?.loader ?? fallback.loader;
    const version = mined?.version ?? fallback.version;
    if (!loader || !version) {
      throw new BadRequestException(
        'This pack does not declare its mod loader or Minecraft version — pick them manually and try again.',
      );
    }

    onProgress({ stage: 'extract', message: 'Applying pack files' });
    await cp(contentRoot, dataDir, {
      recursive: true,
      force: true,
      // itzg installs the loader and owns the start command; the pack's own
      // bootstrap would fight it.
      filter: (src) => {
        const rel = path.relative(contentRoot, src);
        return rel === '' || !isLauncherArtifact(rel.split(path.sep).join('/'));
      },
    });

    onProgress({ stage: 'done', message: 'Pack installed' });
    return {
      loader,
      version,
      ...(mined?.loaderVersion ? { loaderVersion: mined.loaderVersion } : {}),
      blocked: [],
    };
  }
}

/** Every file path under `dir`, relative and slash-separated. */
async function listEntries(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const out: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const dirent of await readdir(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        await walk(path.join(current, dirent.name), rel);
      } else {
        out.push(rel);
      }
    }
  };
  await walk(dir, '');
  return out;
}
```

Move the dynamic `import('node:fs/promises')` in `listEntries` to a top-level import — it is inline above only to keep the snippet self-contained.

Note on `cp`'s `filter`: it is called for directories too, and returning `false` for a directory prunes the whole subtree — which is exactly what `libraries/` and `versions/` need.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter ./backend exec jest src/packs/pack-installer.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/packs/pack-installer.ts backend/src/packs/pack-installer.spec.ts
git commit -m "feat: add pack installer for mrpack, curseforge, and server packs"
```

---

### Task 7: Staging upload endpoint and progress gateway

**Files:**

- Create: `backend/src/packs/packs.controller.ts`, `backend/src/packs/packs.gateway.ts`, `backend/src/packs/packs.module.ts`, `backend/src/packs/pack-staging.service.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/packs/pack-staging.service.spec.ts`, `backend/test/packs.e2e-spec.ts`

**Interfaces:**

- Produces:
  - `POST /packs/staging` (multipart `file`) → `{ token: string }`
  - `PackStagingService.stage(tmpPath: string): Promise<string>` (token), `.resolve(token: string): Promise<string>` (absolute path, throws `BadRequestException` on an unknown or expired token), `.sweep(): Promise<void>`
  - `/packs` socket namespace: client `join {serverId}` / `leave {serverId}`; server emits `progress` (`InstallProgress & { serverId }`)
  - `PacksGateway.emitProgress(serverId: string, progress: InstallProgress): void`

- [ ] **Step 1: Write the failing staging test**

```ts
// backend/src/packs/pack-staging.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PackStagingService } from './pack-staging.service';

async function makeService() {
  const root = await mkdtemp(path.join(tmpdir(), 'mcstage-'));
  const configService = {
    get: (key: string) => (key === 'MC_DATA_ROOT' ? root : undefined),
  } as unknown as ConfigService;
  return { service: new PackStagingService(configService), root };
}

describe('PackStagingService', () => {
  it('moves an upload into the staging area and resolves its token', async () => {
    const { service, root } = await makeService();
    const upload = path.join(root, 'upload.bin');
    await writeFile(upload, 'ZIP');

    const token = await service.stage(upload);
    const resolved = await service.resolve(token);

    expect(resolved.startsWith(path.join(root, '_staging'))).toBe(true);
    expect(await readFile(resolved, 'utf8')).toBe('ZIP');
  });

  it('rejects an unknown token', async () => {
    const { service } = await makeService();
    await expect(service.resolve('nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a token containing a path separator', async () => {
    const { service } = await makeService();
    await expect(service.resolve('../../etc/passwd')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sweeps staged files older than the ttl', async () => {
    const { service, root } = await makeService();
    const upload = path.join(root, 'upload.bin');
    await writeFile(upload, 'ZIP');
    const token = await service.stage(upload);
    const staged = await service.resolve(token);

    // Backdate the file past the TTL.
    const { utimes } = await import('node:fs/promises');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(staged, old, old);

    await service.sweep();

    await expect(stat(staged)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./backend exec jest src/packs/pack-staging.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement staging**

```ts
// backend/src/packs/pack-staging.service.ts
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';

/** Staged uploads are abandoned often (a user closes the wizard). */
const TTL_MS = 60 * 60 * 1000;
const SWEEP_EVERY_MS = 15 * 60 * 1000;

@Injectable()
export class PackStagingService implements OnModuleInit {
  private readonly stagingRoot: string;

  constructor(configService: ConfigService) {
    const dataRoot = configService.get<string>('MC_DATA_ROOT') ?? '/srv/mc';
    this.stagingRoot = path.join(dataRoot, '_staging');
  }

  onModuleInit(): void {
    setInterval(() => void this.sweep(), SWEEP_EVERY_MS).unref();
  }

  async stage(tmpPath: string): Promise<string> {
    await mkdir(this.stagingRoot, { recursive: true });
    const token = randomBytes(16).toString('hex');
    await rename(tmpPath, this.pathFor(token));
    return token;
  }

  async resolve(token: string): Promise<string> {
    // Tokens are hex by construction; anything else is an attack, not a typo.
    if (!/^[a-f0-9]{32}$/.test(token)) {
      throw new BadRequestException('invalid pack token');
    }
    const staged = this.pathFor(token);
    try {
      await access(staged);
    } catch {
      throw new BadRequestException('pack upload expired — upload it again');
    }
    return staged;
  }

  async sweep(): Promise<void> {
    const names = await readdir(this.stagingRoot).catch(() => [] as string[]);
    const cutoff = Date.now() - TTL_MS;
    for (const name of names) {
      const file = path.join(this.stagingRoot, name);
      const info = await stat(file).catch(() => null);
      if (info && info.mtimeMs < cutoff) {
        await rm(file, { force: true, recursive: true }).catch(() => undefined);
      }
    }
  }

  private pathFor(token: string): string {
    return path.join(this.stagingRoot, `${token}.zip`);
  }
}
```

- [ ] **Step 4: Write the controller, gateway and module**

```ts
// backend/src/packs/packs.controller.ts
import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'node:os';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PackStagingService } from './pack-staging.service';
import { MAX_PACK_BYTES } from './pack-downloader';

@UseGuards(JwtAuthGuard)
@Controller('packs')
export class PacksController {
  constructor(private readonly packStagingService: PackStagingService) {}

  @Post('staging')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: MAX_PACK_BYTES },
    }),
  )
  async stage(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ token: string }> {
    return { token: await this.packStagingService.stage(file.path) };
  }
}
```

```ts
// backend/src/packs/packs.gateway.ts
import {
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { SocketAuthService } from '../auth/socket-auth.service';
import { InstallProgress } from './pack-installer';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';

@WebSocketGateway({
  namespace: '/packs',
  cors: { origin: FRONTEND_ORIGIN, credentials: true },
})
export class PacksGateway implements OnGatewayConnection {
  @WebSocketServer() private readonly server!: Namespace;

  constructor(private readonly socketAuthService: SocketAuthService) {}

  handleConnection(client: Socket): void {
    try {
      client.data.user = this.socketAuthService.authenticate(client);
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('join')
  async join(client: Socket, payload: { serverId: string }): Promise<void> {
    await client.join(`server:${payload.serverId}`);
  }

  @SubscribeMessage('leave')
  async leave(client: Socket, payload: { serverId: string }): Promise<void> {
    await client.leave(`server:${payload.serverId}`);
  }

  /**
   * Fire-and-forget: an install must not fail because nobody is watching, so
   * there is no room-occupancy check here. `Server.status` is the durable
   * record; this is only the live view.
   */
  emitProgress(serverId: string, progress: InstallProgress): void {
    this.server?.to(`server:${serverId}`).emit('progress', {
      serverId,
      ...progress,
    });
  }
}
```

```ts
// backend/src/packs/packs.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { ServersModule } from '../servers/servers.module';
import { PacksController } from './packs.controller';
import { PacksGateway } from './packs.gateway';
import { PackStagingService } from './pack-staging.service';
import { PackInstaller } from './pack-installer';
import { PackDownloader } from './pack-downloader';
import { CurseforgeClient } from './curseforge.client';

@Module({
  imports: [AuthModule, FilesModule, ServersModule],
  controllers: [PacksController],
  providers: [
    PacksGateway,
    PackStagingService,
    PackInstaller,
    PackDownloader,
    CurseforgeClient,
  ],
  exports: [PacksGateway, PackStagingService, PackInstaller],
})
export class PacksModule {}
```

Register `PacksModule` in `backend/src/app.module.ts`.

- [ ] **Step 5: Write the e2e test for staging**

```ts
// backend/test/packs.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PackStagingService } from '../src/packs/pack-staging.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

describe('packs staging (e2e)', () => {
  let app: INestApplication;
  const packStagingService = { stage: jest.fn().mockResolvedValue('deadbeef') };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PackStagingService)
      .useValue(packStagingService)
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a multipart upload and returns a token', async () => {
    const res = await request(app.getHttpServer())
      .post('/packs/staging')
      .attach('file', Buffer.from('ZIPDATA'), 'pack.mrpack')
      .expect(201);
    expect(res.body).toEqual({ token: 'deadbeef' });
  });
});
```

- [ ] **Step 6: Run both to verify they pass**

Run: `pnpm --filter ./backend exec jest src/packs/ && pnpm --filter ./backend run test:e2e -- packs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/packs backend/src/app.module.ts backend/test/packs.e2e-spec.ts
git commit -m "feat: add pack staging upload and install progress gateway"
```

---

### Task 8: Create-with-pack flow

**Files:**

- Modify: `backend/src/servers/servers.service.ts`, `backend/src/servers/server.repository.ts`, `backend/src/packs/packs.controller.ts`, `backend/src/packs/packs.module.ts`
- Create: `backend/src/servers/dto/pack-source.dto.ts`, `backend/src/packs/dto/create-server-with-pack.dto.ts`, `backend/src/packs/pack-install.orchestrator.ts`
- Test: `backend/src/servers/servers.service.spec.ts`

**Interfaces:**

- Consumes: `PackInstaller` (Task 6), `PackStagingService` + `PacksGateway` (Task 7).
- Produces:
  - `PackSourceDto` (`{ url?: string; token?: string }`, exactly one required) and `CreateServerWithPackDto` (name/ramMb/port required, loader/version optional, pack required), served by `POST /packs/servers`
  - `ServerRepository.setResolvedPack(id, { loader, version, loaderVersion })`
  - `ServersService.createServer` returns `status: 'installing'` for the pack branch and runs the install in the background, settling on `running` or `failed`

Module direction: `PacksModule` imports `ServersModule`, never the reverse. That is why the pack create route lives on `PacksController` (`POST /packs/servers`) rather than as a branch inside `POST /servers` — a shared route would force a `forwardRef` cycle. The frontend hides the split behind the wizard's mode toggle.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/servers/servers.service.spec.ts — append
it('creates a pending server row without a container for a pack install', async () => {
  const created: Array<Record<string, unknown>> = [];
  const dockerCreate = jest.fn();
  const serversService = makeService({
    serverRepository: {
      create: jest.fn(async (data: Record<string, unknown>) => {
        created.push(data);
        return { id: 's1', ...data, containerId: null, status: 'installing' };
      }),
      setStatus: jest.fn(async (id: string, status: string) => ({
        id,
        status,
      })),
    },
    dockerService: { create: dockerCreate },
  });

  const pending = await serversService.createPending({
    name: 'packed',
    loader: 'forge',
    version: '1.20.1',
    ramMb: 4096,
    port: 25566,
  });

  expect(pending.status).toBe('installing');
  expect(dockerCreate).not.toHaveBeenCalled();
});
```

Adapt to the file's existing `makeService` helper shape.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./backend exec jest src/servers/servers.service.spec.ts`
Expected: FAIL — `createPending` is not a function.

- [ ] **Step 3: Add the pack-source DTO**

```ts
// backend/src/servers/dto/pack-source.dto.ts
import { IsString, IsUrl, Matches, ValidateIf } from 'class-validator';

export class PackSourceDto {
  /** A direct pack URL, or a GitHub release page URL. */
  @ValidateIf((dto: PackSourceDto) => !dto.token)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url?: string;

  /** Token returned by POST /packs/staging for an uploaded pack. */
  @ValidateIf((dto: PackSourceDto) => !dto.url)
  @IsString()
  @Matches(/^[a-f0-9]{32}$/, { message: 'token is not a valid pack token' })
  token?: string;
}
```

`CreateServerDto` is **not** modified: the manual create keeps `loader` and
`version` required, and the pack flow gets its own DTO in Step 6.

- [ ] **Step 4: Add `createPending` and the resolved-pack write**

```ts
// backend/src/servers/servers.service.ts — additions
export interface CreatePendingInput {
  name: string;
  loader?: Loader;
  version?: string;
  loaderVersion?: string;
  ramMb: number;
  port: number;
}

  /**
   * Reserve the name, port and id for a server whose pack has not been
   * installed yet. No container exists until the install resolves the loader
   * and Minecraft version, because itzg reads both from env at create time.
   */
  async createPending(input: CreatePendingInput): Promise<PublicServer> {
    const rconPassword = randomBytes(16).toString('hex');
    try {
      return toPublic(
        await this.serverRepository.create({
          ...input,
          // Placeholders until the pack declares the real values.
          loader: input.loader ?? 'vanilla',
          version: input.version ?? '0',
          rconPassword,
          status: 'installing',
        }),
      );
    } catch (error) {
      throw translateCreateError(error, { name: input.name, port: input.port });
    }
  }

  /** Build and start the container for a row created by `createPending`. */
  async launchResolved(
    id: string,
    resolved: { loader: Loader; version: string; loaderVersion?: string },
  ): Promise<PublicServer> {
    const server = await this.requireServer(id);
    await this.serverRepository.setResolvedPack(id, resolved);
    const containerId = await this.dockerService.create({
      id,
      port: server.port,
      env: toItzgEnv({
        loader: resolved.loader,
        version: resolved.version,
        loaderVersion: resolved.loaderVersion,
        ramMb: server.ramMb,
        rconPassword: server.rconPassword,
      }),
      memoryMb: server.ramMb,
    });
    await this.dockerService.start(containerId);
    return toPublic(
      await this.serverRepository.setContainer(id, containerId, 'running'),
    );
  }

  async markFailed(id: string): Promise<void> {
    await this.serverRepository.setStatus(id, 'failed').catch(() => undefined);
  }
```

`ServerRepository.create` must accept `status`, and gains:

```ts
// backend/src/servers/server.repository.ts
  setResolvedPack(
    id: string,
    resolved: { loader: string; version: string; loaderVersion?: string },
  ): Promise<ServerRecord> {
    return this.updateOrNotFound(id, {
      loader: resolved.loader,
      version: resolved.version,
      loaderVersion: resolved.loaderVersion ?? null,
    });
  }
```

- [ ] **Step 5: Write the orchestrator (inside `PacksModule`, so the dependency stays one-way)**

```ts
// backend/src/packs/pack-install.orchestrator.ts
import { Injectable, Logger } from '@nestjs/common';
import { ServersService } from '../servers/servers.service';
import { Loader } from '../servers/provisioning';
import { PackInstaller } from './pack-installer';
import { PackStagingService } from './pack-staging.service';
import { PacksGateway } from './packs.gateway';

export interface CreateWithPackInput {
  name: string;
  loader?: Loader;
  version?: string;
  loaderVersion?: string;
  ramMb: number;
  port: number;
  pack: { url?: string; token?: string };
}

@Injectable()
export class PackInstallOrchestrator {
  private readonly logger = new Logger(PackInstallOrchestrator.name);

  constructor(
    private readonly serversService: ServersService,
    private readonly packInstaller: PackInstaller,
    private readonly packStagingService: PackStagingService,
    private readonly packsGateway: PacksGateway,
  ) {}

  /**
   * Reserve the row, answer the request, then install in the background: a
   * multi-gigabyte pack takes minutes, and an HTTP request held open that
   * long dies to every proxy in the path. `Server.status` is the durable
   * record of how it ended.
   */
  async start(input: CreateWithPackInput): Promise<{ id: string }> {
    const pending = await this.serversService.createPending(input);
    void this.run(pending.id, input);
    return { id: pending.id };
  }

  private async run(id: string, input: CreateWithPackInput): Promise<void> {
    try {
      const stagedPath = input.pack.token
        ? await this.packStagingService.resolve(input.pack.token)
        : undefined;
      const result = await this.packInstaller.install(
        id,
        { url: input.pack.url, stagedPath },
        { loader: input.loader, version: input.version },
        (progress) => this.packsGateway.emitProgress(id, progress),
      );
      await this.serversService.launchResolved(id, result);
      this.packsGateway.emitProgress(id, {
        stage: 'done',
        message:
          result.blocked.length > 0
            ? `Server started. ${result.blocked.length} mod(s) could not be downloaded — add them in the Files tab.`
            : 'Server started.',
      });
    } catch (error) {
      this.logger.error(`pack install failed for ${id}: ${String(error)}`);
      this.packsGateway.emitProgress(id, {
        stage: 'failed',
        message: error instanceof Error ? error.message : 'pack install failed',
      });
      // Nothing usable exists, so take the whole server with it: the name and
      // port free up and the user can retry immediately.
      await this.serversService.deleteServer(id).catch(() => undefined);
    }
  }
}
```

Register `PackInstallOrchestrator` in `PacksModule` providers and exports.

- [ ] **Step 6: Add the pack create route**

`PacksModule` owns the pack create route. `ServersModule` must not import
`PacksModule` (`PacksModule` already imports `ServersModule`), so the two
flows get one route each and the dependency stays one-directional — no
`forwardRef`.

```ts
// backend/src/packs/dto/create-server-with-pack.dto.ts
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LOADERS, Loader } from '../../servers/provisioning';
import { PackSourceDto } from '../../servers/dto/pack-source.dto';

export class CreateServerWithPackDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,31}$/i, {
    message: 'name must be 1-32 chars: letters, digits, hyphens',
  })
  name!: string;

  /** Only used when the pack declares neither loader nor version. */
  @IsOptional()
  @IsIn(LOADERS)
  loader?: Loader;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9][0-9A-Za-z._-]{0,31}$/, {
    message: 'version has an invalid format',
  })
  version?: string;

  @IsInt()
  @Min(512)
  @Max(32768)
  ramMb!: number;

  @IsInt()
  @Min(1024)
  @Max(65535)
  port!: number;

  @ValidateNested()
  @Type(() => PackSourceDto)
  pack!: PackSourceDto;
}
```

```ts
// backend/src/packs/packs.controller.ts — add alongside the staging route
  @Post('servers')
  createWithPack(
    @Body() dto: CreateServerWithPackDto,
  ): Promise<{ id: string }> {
    return this.packInstallOrchestrator.start(dto);
  }
```

`ServersController.create` and `CreateServerDto` keep `loader` and `version`
**required** and are otherwise unchanged — revert the `ValidateIf` edits from
Step 3 on `CreateServerDto`; only `PackSourceDto` (a new file) stays, since
`CreateServerWithPackDto` imports it.

- [ ] **Step 7: Run the suites**

Run: `pnpm --filter ./backend test && pnpm --filter ./backend run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src
git commit -m "feat: create a server from a pack in the background"
```

---

### Task 9: Frontend pack step and install progress

**Files:**

- Create: `frontend/src/ui/Progress.tsx`, `frontend/src/modules/packs/{api.ts,hooks.ts,socket.ts,index.ts}`, `frontend/src/modules/packs/components/{PackSourceStep,InstallProgress}.tsx`
- Modify: `frontend/src/ui/index.ts`, `frontend/src/constants/index.ts`, `frontend/src/types/api.ts`, `frontend/src/modules/servers/components/CreateWizard.tsx`, `frontend/src/app/(panel)/servers/[id]/page.tsx`
- Test: `frontend/src/modules/packs/components/PackSourceStep.test.tsx`, `frontend/src/modules/packs/components/InstallProgress.test.tsx`, `frontend/src/modules/servers/components/CreateWizard.test.tsx` (extend)

**Interfaces:**

- Produces:
  - types `PackSource = { url: string } | { token: string }`, `InstallProgress { serverId: string; stage: 'download' | 'inspect' | 'mods' | 'extract' | 'done' | 'failed'; message: string; done?: number; total?: number }`
  - `uploadPack(file: File): Promise<{ token: string }>`, `createServerWithPack(body): Promise<{ id: string }>`
  - `subscribeInstall(serverId, cb): () => void` (same shape as `modules/metrics/socket.ts`)
  - `PackSourceStep({ value, onChange })`, `InstallProgress({ serverId })`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/modules/packs/components/PackSourceStep.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackSourceStep } from './PackSourceStep';

describe('PackSourceStep', () => {
  it('reports a pasted url upward', async () => {
    const onChange = jest.fn();
    render(<PackSourceStep value={null} onChange={onChange} />);

    await userEvent.type(
      screen.getByLabelText('Pack URL'),
      'https://example.com/pack.mrpack',
    );

    expect(onChange).toHaveBeenLastCalledWith({
      url: 'https://example.com/pack.mrpack',
    });
  });

  it('uploads a chosen file and reports its token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ token: 'a'.repeat(32) }),
    }) as unknown as typeof fetch;
    const onChange = jest.fn();
    render(<PackSourceStep value={null} onChange={onChange} />);

    await userEvent.upload(
      screen.getByLabelText('Pack file'),
      new File(['ZIP'], 'pack.mrpack'),
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ token: 'a'.repeat(32) }),
    );
  });
});
```

```tsx
// frontend/src/modules/packs/components/InstallProgress.test.tsx
import { render, screen, act } from '@testing-library/react';
import { InstallProgress } from './InstallProgress';
import * as socket from '../socket';

describe('InstallProgress', () => {
  it('renders the latest progress message and the mod counter', () => {
    let emit: (p: unknown) => void = () => undefined;
    jest.spyOn(socket, 'subscribeInstall').mockImplementation((_id, cb) => {
      emit = cb as (p: unknown) => void;
      return () => undefined;
    });

    render(<InstallProgress serverId="s1" />);

    act(() =>
      emit({
        serverId: 's1',
        stage: 'mods',
        message: 'Downloading mods (3/10)',
        done: 3,
        total: 10,
      }),
    );

    expect(screen.getByText('Downloading mods (3/10)')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '30',
    );
  });

  it('shows a failure message in red', () => {
    let emit: (p: unknown) => void = () => undefined;
    jest.spyOn(socket, 'subscribeInstall').mockImplementation((_id, cb) => {
      emit = cb as (p: unknown) => void;
      return () => undefined;
    });

    render(<InstallProgress serverId="s1" />);
    act(() =>
      emit({ serverId: 's1', stage: 'failed', message: 'checksum mismatch' }),
    );

    expect(screen.getByText('checksum mismatch')).toHaveClass('text-red-400');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter ./frontend test -- src/modules/packs`
Expected: FAIL — modules not found.

- [ ] **Step 3: Add the `Progress` primitive**

```tsx
// frontend/src/ui/Progress.tsx
'use client';

export function Progress({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded bg-neutral-800"
    >
      <div className="h-full bg-emerald-500" style={{ width: `${clamped}%` }} />
    </div>
  );
}
```

Export it from `frontend/src/ui/index.ts`.

- [ ] **Step 4: Add the packs module**

```ts
// frontend/src/types/api.ts — append
export type PackSource = { url: string } | { token: string };

export interface InstallProgress {
  serverId: string;
  stage: 'download' | 'inspect' | 'mods' | 'extract' | 'done' | 'failed';
  message: string;
  done?: number;
  total?: number;
}
```

```ts
// frontend/src/modules/packs/api.ts
import { api } from '@/lib/api-client';
import { API_URL } from '@/constants';
import type { Loader, PackSource } from '@/types';

export interface CreateWithPackBody {
  name: string;
  ramMb: number;
  port: number;
  loader?: Loader;
  version?: string;
  pack: PackSource;
}

export const createServerWithPack = (body: CreateWithPackBody) =>
  api<{ id: string }>('/packs/servers', {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** Multipart: must not carry the JSON content type `api()` sets. */
export async function uploadPack(file: File): Promise<{ token: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_URL}/packs/staging`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return JSON.parse(await res.text()) as { token: string };
}
```

```ts
// frontend/src/modules/packs/socket.ts
import type { Socket } from 'socket.io-client';
import { makeSocket } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/constants';
import type { InstallProgress } from '@/types';

type Listener = (progress: InstallProgress) => void;

let socket: Socket | null = null;
const listeners = new Map<string, Set<Listener>>();

function ensureSocket(): Socket {
  if (socket) return socket;
  const s = makeSocket('/packs');
  socket = s;
  s.on('progress', (payload: InstallProgress) => {
    listeners.get(payload.serverId)?.forEach((cb) => cb(payload));
  });
  s.on('connect', () => {
    for (const serverId of listeners.keys()) {
      s.emit(SOCKET_EVENTS.join, { serverId });
    }
  });
  return s;
}

/**
 * Progress is a live view only — `Server.status` is the durable record — so
 * this socket is torn down as soon as the last viewer leaves. No grace
 * window, unlike metrics: an install is watched once, not tab-switched.
 */
export function subscribeInstall(serverId: string, cb: Listener): () => void {
  const s = ensureSocket();
  let set = listeners.get(serverId);
  if (!set) {
    set = new Set();
    listeners.set(serverId, set);
    s.emit(SOCKET_EVENTS.join, { serverId });
  }
  set.add(cb);

  return () => {
    const current = listeners.get(serverId);
    if (!current?.has(cb)) return;
    current.delete(cb);
    if (current.size > 0) return;
    listeners.delete(serverId);
    socket?.emit(SOCKET_EVENTS.leave, { serverId });
    if (listeners.size === 0) {
      socket?.disconnect();
      socket = null;
    }
  };
}
```

```ts
// frontend/src/modules/packs/hooks.ts
'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import {
  createServerWithPack,
  uploadPack,
  type CreateWithPackBody,
} from './api';

export function useCreateServerWithPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWithPackBody) => createServerWithPack(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.servers }),
  });
}

export function useUploadPack() {
  return useMutation({ mutationFn: (file: File) => uploadPack(file) });
}
```

```ts
// frontend/src/modules/packs/index.ts
export * from './hooks';
export { subscribeInstall } from './socket';
export { PackSourceStep } from './components/PackSourceStep';
export { InstallProgress } from './components/InstallProgress';
export type { CreateWithPackBody } from './api';
```

- [ ] **Step 5: Write the components**

```tsx
// frontend/src/modules/packs/components/PackSourceStep.tsx
'use client';
import { useState } from 'react';
import { Input, Spinner } from '@ui';
import { errorText } from '@/lib/errors';
import type { PackSource } from '@/types';
import { useUploadPack } from '../hooks';

export function PackSourceStep({
  value,
  onChange,
}: {
  value: PackSource | null;
  onChange: (source: PackSource | null) => void;
}) {
  const [url, setUrl] = useState('');
  const upload = useUploadPack();

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Pack URL"
        placeholder="https://…/pack.mrpack, a CurseForge zip, or a GitHub release asset"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          onChange(e.target.value ? { url: e.target.value } : null);
        }}
      />
      <label className="flex flex-col gap-1 text-sm">
        Pack file
        <input
          aria-label="Pack file"
          type="file"
          accept=".zip,.mrpack"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUrl('');
            upload.mutate(file, {
              onSuccess: (result) => onChange({ token: result.token }),
            });
          }}
        />
      </label>
      {upload.isPending && <Spinner />}
      {upload.isError && (
        <p className="text-red-400">{errorText(upload.error)}</p>
      )}
      {value && 'token' in value && (
        <p className="text-xs text-emerald-400">Pack uploaded.</p>
      )}
      <p className="text-xs text-neutral-500">
        Modrinth packs and most GitHub server packs set the loader and version
        themselves. CurseForge packs need a server API key, and mods whose
        authors block third-party downloads must be added by hand afterwards.
      </p>
    </div>
  );
}
```

```tsx
// frontend/src/modules/packs/components/InstallProgress.tsx
'use client';
import { useEffect, useState } from 'react';
import { Progress } from '@ui';
import type { InstallProgress as Progress_ } from '@/types';
import { subscribeInstall } from '../socket';

export function InstallProgress({ serverId }: { serverId: string }) {
  const [latest, setLatest] = useState<Progress_ | null>(null);

  useEffect(() => subscribeInstall(serverId, setLatest), [serverId]);

  if (!latest) {
    return <p className="text-sm text-neutral-400">Installing pack…</p>;
  }
  const percent =
    latest.total && latest.total > 0
      ? ((latest.done ?? 0) / latest.total) * 100
      : latest.stage === 'done'
        ? 100
        : 10;

  return (
    <div className="flex flex-col gap-2">
      <p
        className={
          latest.stage === 'failed' ? 'text-red-400' : 'text-neutral-300'
        }
      >
        {latest.message}
      </p>
      <Progress percent={percent} />
    </div>
  );
}
```

- [ ] **Step 6: Extend the wizard**

In `CreateWizard.tsx`, add a source mode toggle:

```tsx
const [mode, setMode] = useState<'manual' | 'pack'>('manual');
const [pack, setPack] = useState<PackSource | null>(null);
const createWithPack = useCreateServerWithPack();
```

Render two radio-style buttons (`Choose loader manually` / `Install a modpack`). In `pack` mode, replace the loader/version/build selects with `<PackSourceStep value={pack} onChange={setPack} />`, keep name/RAM/port, and submit through `createWithPack.mutate({ name, ramMb, port, pack }, { onSuccess: ({ id }) => onCreated(id) })`. Keep the existing manual path untouched, and disable submit in pack mode until `pack !== null`.

Add to `CreateWizard.test.tsx`:

```tsx
it('submits a pack url instead of a loader when in pack mode', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 201,
    text: async () => JSON.stringify({ id: 's9' }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  renderWizard(); // the file's existing helper

  await userEvent.click(screen.getByRole('button', { name: /modpack/i }));
  await userEvent.type(screen.getByLabelText('Name'), 'packed');
  await userEvent.type(
    screen.getByLabelText('Pack URL'),
    'https://example.com/pack.mrpack',
  );
  await userEvent.click(screen.getByRole('button', { name: /create/i }));

  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('/packs/servers')),
    ).toBe(true),
  );
});
```

- [ ] **Step 7: Show progress on the server page**

In `frontend/src/app/(panel)/servers/[id]/page.tsx`, when `server.status === 'installing'`, render `<InstallProgress serverId={server.id} />` above the tabs and skip the Console/Metrics tabs (there is no container yet):

```tsx
if (server.status === 'installing') {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{server.name}</h1>
      <InstallProgress serverId={server.id} />
    </div>
  );
}
```

Add `'installing'` to `ServerStatus` in `frontend/src/types/api.ts`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter ./frontend test`
Expected: PASS, including the extended `CreateWizard` suite.

- [ ] **Step 9: Commit**

```bash
git add frontend/src
git commit -m "feat: add pack source step and install progress to the wizard"
```

---

### Task 10: e2e coverage, docs, full gate

**Files:**

- Modify: `frontend/e2e/mocks.ts`, `frontend/e2e/panel.spec.ts`, `backend/AGENTS.md`, `AGENTS.md`, `docs/superpowers/specs/2026-09-12-files-backups-packs-design.md` (status line only)

- [ ] **Step 1: Add the route mocks and e2e test**

```ts
// frontend/e2e/mocks.ts — add
export async function mockPackCreate(page: Page): Promise<void> {
  await page.route('**/packs/servers', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 's9' }),
    }),
  );
}
```

```ts
// frontend/e2e/panel.spec.ts — append
test('creates a server from a pack url', async ({ page }) => {
  await mockPackCreate(page);
  await page.goto('/');
  await page.getByRole('button', { name: /create server/i }).click();
  await page.getByRole('button', { name: /modpack/i }).click();
  await page.getByLabel('Name').fill('packed');
  await page.getByLabel('Pack URL').fill('https://example.com/pack.mrpack');
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page).toHaveURL(/\/servers\/s9/);
});
```

Match the file's existing helpers for opening the create modal rather than assuming the button label.

- [ ] **Step 2: Run it**

Run: `pnpm --filter ./frontend e2e -- --grep "from a pack url"`
Expected: PASS.

- [ ] **Step 3: Document the module**

Add to `backend/AGENTS.md`:

```markdown
- `packs/` — pack install **at server creation only**. `PacksController`
  exposes `POST /packs/staging` (multipart upload → token) and
  `POST /packs/servers` (create-with-pack; the manual create stays on
  `POST /servers`). `PackInstallOrchestrator` reserves the row via
  `ServersService.createPending`, returns at once, installs in the
  background, then calls `launchResolved` — or deletes the server on
  failure. `PackInstaller` sequences the pure `pack-format.ts`
  (`classify` / `stripRoot` / `mineLoader` / `isLauncherArtifact`,
  `parseMrpack`, `parseCurseforgeManifest`), `PackDownloader` (size cap,
  timeout, sha512) and `CurseforgeClient` (needs `CURSEFORGE_API_KEY`;
  distribution-blocked mods are reported, never guessed). Progress streams
  over the `/packs` gateway. `PacksModule` imports `ServersModule` and
  `FilesModule` — never the reverse, so there is no cycle. Optional env:
  `CURSEFORGE_API_KEY`, `MAX_PACK_MB` (default 4096).
```

Note in the root `AGENTS.md` that `fabric` is now a valid loader for pack-declared installs but is not offered in the manual wizard, and add `src/modules/packs` to the frontend module list.

- [ ] **Step 4: Run the full gate**

Run: `pnpm build && pnpm test && pnpm test:e2e && pnpm fallow && pnpm --filter ./frontend test && pnpm --filter ./frontend typecheck && pnpm --filter ./frontend e2e`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e backend/AGENTS.md AGENTS.md
git commit -m "test: cover pack-based server creation end to end"
```

---

## Self-Review

**Spec coverage.** Pack from URL or uploaded file → Tasks 4, 7, 8, 9. `.mrpack` with sha512 verification and client-only filtering → Tasks 2, 4, 6. CurseForge with `CURSEFORGE_API_KEY` and a blocked-mod report → Tasks 5, 6, 8. Server-pack zips incl. GitHub shape, root stripping, launcher denylist, loader mining → Tasks 1, 6. Classification by content not extension → Task 1. Create-only, background install, `status: 'installing'` → Task 8. Failure rolls back container, row and data root → Task 8 (`deleteServer`, which the file-manager plan taught to remove the data root). `/packs` progress socket with the shared handshake auth → Tasks 7, 9. Fabric as a pack-declared loader, absent from the manual dropdown → Tasks 3, 9. Staging TTL sweep → Task 7. `Progress` primitive → Task 9.

**Type consistency.** `Loader` comes from `servers/provisioning.ts` throughout, including `pack-format.ts` and the orchestrator. `InstallProgress` is declared once in `pack-installer.ts` and mirrored in `frontend/src/types/api.ts` with the extra `serverId` the gateway adds. `PackFile` covers both URL-bearing (mrpack) and id-bearing (CurseForge) entries; `fetchMods` is the single place that branches on which.

**Deliberate divergence from the spec's wording.** The spec described one create route taking an optional `pack`. Implementing it that way makes `ServersModule` depend on `PacksModule` while `PacksModule` already depends on `ServersModule` — a cycle needing `forwardRef`. Task 8 instead splits the route: `POST /servers` for the manual flow, `POST /packs/servers` for the pack flow. Same user-visible behavior, one-directional dependencies. The frontend wizard hides the split behind its mode toggle.
