# Provisioning + Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the backend the ability to create a Minecraft server (one `itzg/minecraft-server` Docker container), start/stop/restart/delete it, list servers, and fetch selectable versions per loader — all behind auth.

**Architecture:** A `DockerService` is the single wrapper over `dockerode` (nothing else imports `dockerode`). A pure `toItzgEnv()` mapper turns wizard input into itzg env vars. `ServersService` orchestrates: it persists a `Server` row through `ServerRepository`, asks `DockerService` to create+start a container, and rolls back to `failed` on error. A `VersionsService` fetches upstream manifests (Mojang / PaperMC / Forge / NeoForge) through an injected `HttpFetcher` so tests never hit the network. All HTTP routes are guarded by the existing `JwtAuthGuard`.

**Tech Stack:** Nest 11 (CommonJS), Prisma 6 + SQLite, TypeScript 5.9, `dockerode`, Node 20 global `fetch`, Jest + ts-jest + supertest.

## Global Constraints

- **TypeScript 5.9 / Nest 11 / CommonJS.** Do NOT introduce TS7 or Prisma 7.
- **Package manager: pnpm.** All commands run from repo root with `--filter ./backend` (the package name is `mc-panel-backend`, so `--filter backend` will NOT match).
- **Layering rule:** controller → service → repository. Only repository classes may inject `PrismaService`. Only `DockerService` may import `dockerode`.
- **Imports:** with `esModuleInterface`/TS5.9 in this repo, `import * as X from 'x'` fails for CJS default-callable modules (TS2349). Use default imports: `import Docker from 'dockerode'`, `import cookieParser from 'cookie-parser'`, `import request from 'supertest'`.
- **Auth:** every new HTTP route is behind `@UseGuards(JwtAuthGuard)`. No unauthenticated routes.
- **Security:** all container inputs (name, version, ports, env values) are validated/sanitized in the DTO before they reach `DockerService`. RCON password is generated server-side, stored server-side, never returned to clients.
- **No `.env` committed.** Optional new env vars have safe defaults.
- **Docker-dependent tests must be opt-in.** The pre-push hook runs `pnpm test:e2e`; nothing in the default unit/e2e run may require a real Docker daemon. Real-daemon tests are `describe.skip` unless `MC_DOCKER_E2E=1`.

## New/changed files

- Create `backend/src/servers/server.repository.ts` (+ `.spec.ts`) — Prisma boundary for the `Server` table.
- Create `backend/src/servers/provisioning.ts` (+ `.spec.ts`) — pure `toItzgEnv()` mapper + loader constants.
- Create `backend/src/servers/docker.service.ts` (+ `.spec.ts`) — sole `dockerode` wrapper.
- Create `backend/src/servers/servers.service.ts` (+ `.spec.ts`) — orchestration.
- Create `backend/src/servers/dto/create-server.dto.ts` — validated wizard input.
- Create `backend/src/servers/servers.controller.ts` — guarded REST routes.
- Create `backend/src/servers/servers.module.ts` — wires the above.
- Create `backend/src/versions/http-fetcher.ts` — `HttpFetcher` interface + `FetchHttpFetcher` (global `fetch`).
- Create `backend/src/versions/fetchers.ts` (+ `.spec.ts`) — 4 per-loader parsers.
- Create `backend/src/versions/versions.service.ts` (+ `.spec.ts`) — loader → fetcher, with TTL cache.
- Create `backend/src/versions/versions.controller.ts` + `versions.module.ts`.
- Modify `backend/prisma/schema.prisma` — add `Server` model (+ migration).
- Modify `backend/src/app.module.ts` — import `ServersModule`, `VersionsModule`.
- Create `backend/test/servers.e2e-spec.ts` — full HTTP flow with `DockerService` overridden.
- Modify `backend/AGENTS.md` — document servers/versions modules + Docker env vars.

---

### Task 1: `Server` model + `ServerRepository`

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<generated>/migration.sql` (via `prisma migrate dev`)
- Create: `backend/src/servers/server.repository.ts`
- Test: `backend/src/servers/server.repository.spec.ts`
- Modify: `backend/package.json` (add deps)

**Interfaces:**

- Produces:
  - `ServerRecord = { id: string; name: string; loader: string; version: string; ramMb: number; port: number; rconPassword: string; containerId: string | null; status: string; createdAt: Date }`
  - `CreateServerData = { name: string; loader: string; version: string; ramMb: number; port: number; rconPassword: string }`
  - `class ServerRepository` with:
    - `create(data: CreateServerData): Promise<ServerRecord>` — `status` defaults to `'creating'`; P2002 → `ConflictException`.
    - `findById(id: string): Promise<ServerRecord | null>`
    - `list(): Promise<ServerRecord[]>` (order by `createdAt` asc)
    - `setContainer(id: string, containerId: string, status: string): Promise<ServerRecord>` — P2025 → `NotFoundException`.
    - `setStatus(id: string, status: string): Promise<ServerRecord>` — P2025 → `NotFoundException`.
    - `delete(id: string): Promise<void>` — P2025 → `NotFoundException`.

- [ ] **Step 1: Add dependencies**

Run from repo root:

```bash
pnpm --filter ./backend add dockerode
pnpm --filter ./backend add -D @types/dockerode
```

- [ ] **Step 2: Add the `Server` model to the Prisma schema**

In `backend/prisma/schema.prisma`, append below the `User` model:

```prisma
model Server {
  id           String   @id @default(cuid())
  name         String   @unique
  loader       String
  version      String
  ramMb        Int
  port         Int      @unique
  rconPassword String
  containerId  String?
  status       String   @default("creating")
  createdAt    DateTime @default(now())
}
```

- [ ] **Step 3: Create the migration + regenerate the client**

Run from repo root:

```bash
pnpm --filter ./backend exec prisma migrate dev --name add_server_model
```

Expected: a new folder under `backend/prisma/migrations/` and the client regenerated (so `prisma.server` is typed).

- [ ] **Step 4: Write the failing repository test**

Create `backend/src/servers/server.repository.spec.ts` (mirrors the `UserRepository` mock pattern):

```typescript
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ServerRepository } from './server.repository';
import { PrismaService } from '../prisma/prisma.service';

function makePrismaMock(): jest.Mocked<PrismaService> {
  return {
    server: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('mock prisma error', {
    code,
    clientVersion: 'test',
  });
}

describe('ServerRepository', () => {
  const data = {
    name: 'survival',
    loader: 'vanilla',
    version: '1.20.1',
    ramMb: 2048,
    port: 25565,
    rconPassword: 'secret',
  };

  it('translates a P2002 unique violation on create to ConflictException', async () => {
    const prisma = makePrismaMock();
    (prisma.server.create as jest.Mock).mockRejectedValue(
      knownRequestError('P2002'),
    );
    const repo = new ServerRepository(prisma);
    await expect(repo.create(data)).rejects.toThrow(ConflictException);
  });

  it('rethrows non-Prisma errors from create unchanged', async () => {
    const prisma = makePrismaMock();
    const other = new Error('boom');
    (prisma.server.create as jest.Mock).mockRejectedValue(other);
    const repo = new ServerRepository(prisma);
    await expect(repo.create(data)).rejects.toBe(other);
  });

  it('translates a P2025 not-found on setStatus to NotFoundException', async () => {
    const prisma = makePrismaMock();
    (prisma.server.update as jest.Mock).mockRejectedValue(
      knownRequestError('P2025'),
    );
    const repo = new ServerRepository(prisma);
    await expect(repo.setStatus('missing', 'running')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('translates a P2025 not-found on delete to NotFoundException', async () => {
    const prisma = makePrismaMock();
    (prisma.server.delete as jest.Mock).mockRejectedValue(
      knownRequestError('P2025'),
    );
    const repo = new ServerRepository(prisma);
    await expect(repo.delete('missing')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter ./backend test -- server.repository`
Expected: FAIL — `Cannot find module './server.repository'`.

- [ ] **Step 6: Implement the repository**

Create `backend/src/servers/server.repository.ts`:

```typescript
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ServerRecord {
  id: string;
  name: string;
  loader: string;
  version: string;
  ramMb: number;
  port: number;
  rconPassword: string;
  containerId: string | null;
  status: string;
  createdAt: Date;
}

export interface CreateServerData {
  name: string;
  loader: string;
  version: string;
  ramMb: number;
  port: number;
  rconPassword: string;
}

@Injectable()
export class ServerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateServerData): Promise<ServerRecord> {
    try {
      return await this.prisma.server.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = (error.meta?.target as string[] | undefined)?.join(', ');
        throw new ConflictException(
          `A server with that ${target ?? 'name or port'} already exists`,
        );
      }
      throw error;
    }
  }

  findById(id: string): Promise<ServerRecord | null> {
    return this.prisma.server.findUnique({ where: { id } });
  }

  list(): Promise<ServerRecord[]> {
    return this.prisma.server.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async setContainer(
    id: string,
    containerId: string,
    status: string,
  ): Promise<ServerRecord> {
    return this.updateOrNotFound(id, { containerId, status });
  }

  async setStatus(id: string, status: string): Promise<ServerRecord> {
    return this.updateOrNotFound(id, { status });
  }

  private async updateOrNotFound(
    id: string,
    data: Prisma.ServerUpdateInput,
  ): Promise<ServerRecord> {
    try {
      return await this.prisma.server.update({ where: { id }, data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Server "${id}" not found`);
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.server.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Server "${id}" not found`);
      }
      throw error;
    }
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter ./backend test -- server.repository`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/servers/server.repository.ts backend/src/servers/server.repository.spec.ts backend/package.json ../pnpm-lock.yaml
git commit -m "feat(servers): add Server model + ServerRepository"
```

(If `pnpm-lock.yaml` is at repo root, add it with its real path; adjust as needed.)

---

### Task 2: `toItzgEnv()` provisioning mapper

**Files:**

- Create: `backend/src/servers/provisioning.ts`
- Test: `backend/src/servers/provisioning.spec.ts`

**Interfaces:**

- Consumes: nothing (pure module).
- Produces:
  - `LOADERS = ['vanilla', 'paper', 'forge', 'neoforge'] as const`
  - `type Loader = (typeof LOADERS)[number]`
  - `toItzgEnv(input: { loader: Loader; version: string; ramMb: number; rconPassword: string }): string[]` — returns itzg env lines (`KEY=VALUE`).

- [ ] **Step 1: Write the failing test**

Create `backend/src/servers/provisioning.spec.ts`:

```typescript
import { toItzgEnv } from './provisioning';

describe('toItzgEnv', () => {
  const base = { version: '1.20.1', ramMb: 2048, rconPassword: 'pw' };

  it('always sets EULA, memory, and RCON', () => {
    const env = toItzgEnv({ loader: 'vanilla', ...base });
    expect(env).toContain('EULA=TRUE');
    expect(env).toContain('MEMORY=2048M');
    expect(env).toContain('ENABLE_RCON=TRUE');
    expect(env).toContain('RCON_PASSWORD=pw');
    expect(env).toContain('VERSION=1.20.1');
  });

  it('maps each loader to its itzg TYPE', () => {
    expect(toItzgEnv({ loader: 'vanilla', ...base })).toContain('TYPE=VANILLA');
    expect(toItzgEnv({ loader: 'paper', ...base })).toContain('TYPE=PAPER');
    expect(toItzgEnv({ loader: 'forge', ...base })).toContain('TYPE=FORGE');
    expect(toItzgEnv({ loader: 'neoforge', ...base })).toContain(
      'TYPE=NEOFORGE',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ./backend test -- provisioning`
Expected: FAIL — `Cannot find module './provisioning'`.

- [ ] **Step 3: Implement the mapper**

Create `backend/src/servers/provisioning.ts`:

```typescript
export const LOADERS = ['vanilla', 'paper', 'forge', 'neoforge'] as const;
export type Loader = (typeof LOADERS)[number];

const ITZG_TYPE: Record<Loader, string> = {
  vanilla: 'VANILLA',
  paper: 'PAPER',
  forge: 'FORGE',
  neoforge: 'NEOFORGE',
};

export interface ProvisionInput {
  loader: Loader;
  version: string;
  ramMb: number;
  rconPassword: string;
}

/**
 * Map wizard input to itzg/minecraft-server env vars. The loader BUILD
 * (e.g. exact Forge build) is left for itzg to auto-resolve from the MC
 * VERSION — Phase 1 only lets the user pick the Minecraft version.
 */
export function toItzgEnv(input: ProvisionInput): string[] {
  return [
    'EULA=TRUE',
    `TYPE=${ITZG_TYPE[input.loader]}`,
    `VERSION=${input.version}`,
    `MEMORY=${input.ramMb}M`,
    'ENABLE_RCON=TRUE',
    `RCON_PASSWORD=${input.rconPassword}`,
    'RCON_PORT=25575',
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ./backend test -- provisioning`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/servers/provisioning.ts backend/src/servers/provisioning.spec.ts
git commit -m "feat(servers): pure itzg env mapper for loaders"
```

---

### Task 3: `DockerService` (sole `dockerode` wrapper)

**Files:**

- Create: `backend/src/servers/docker.service.ts`
- Test: `backend/src/servers/docker.service.spec.ts`

**Interfaces:**

- Consumes: `ConfigService` (`@nestjs/config`) for optional `MC_DATA_ROOT` (default `/srv/mc`) and `MC_IMAGE` (default `itzg/minecraft-server`).
- Produces:
  - `interface CreateContainerOptions { id: string; port: number; env: string[] }`
  - `interface ContainerStatus { running: boolean; status: string }`
  - `class DockerService` with:
    - `create(opts: CreateContainerOptions): Promise<string>` — mkdirs the data dir, calls `docker.createContainer(...)`, returns `container.id`.
    - `start(containerId: string): Promise<void>`
    - `stop(containerId: string): Promise<void>` — treats "already stopped" (HTTP 304) as success.
    - `restart(containerId: string): Promise<void>`
    - `remove(containerId: string): Promise<void>` — `force: true`; treats "no such container" (404) as success.
    - `inspect(containerId: string): Promise<ContainerStatus>`

**Note on the mkdir:** the container binds `<MC_DATA_ROOT>/<id>/data` → `/data`. Create it recursively before container creation so itzg has a writable dir. Host ownership is left to itzg's defaults for Phase 1 (documented limitation — revisit with PUID/PGID when the file manager lands).

- [ ] **Step 1: Write the failing test (dockerode mocked)**

Create `backend/src/servers/docker.service.spec.ts`:

```typescript
const createContainer = jest.fn();
const getContainer = jest.fn();

jest.mock('dockerode', () =>
  jest.fn().mockImplementation(() => ({ createContainer, getContainer })),
);
jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

import { mkdir } from 'node:fs/promises';
import { DockerService } from './docker.service';

function makeService(): DockerService {
  const config = {
    get: (key: string) =>
      key === 'MC_DATA_ROOT' ? '/tmp/mc' : 'itzg/minecraft-server',
  } as unknown as import('@nestjs/config').ConfigService;
  return new DockerService(config);
}

describe('DockerService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a container with the correct image, name, bind, port, and env', async () => {
    createContainer.mockResolvedValue({ id: 'container123' });
    const svc = makeService();

    const id = await svc.create({
      id: 'srv1',
      port: 25565,
      env: ['EULA=TRUE', 'TYPE=VANILLA'],
    });

    expect(id).toBe('container123');
    expect(mkdir).toHaveBeenCalledWith('/tmp/mc/srv1/data', {
      recursive: true,
    });
    const cfg = createContainer.mock.calls[0][0];
    expect(cfg.Image).toBe('itzg/minecraft-server');
    expect(cfg.name).toBe('mc-server-srv1');
    expect(cfg.Env).toEqual(['EULA=TRUE', 'TYPE=VANILLA']);
    expect(cfg.HostConfig.Binds).toEqual(['/tmp/mc/srv1/data:/data']);
    expect(cfg.HostConfig.PortBindings['25565/tcp']).toEqual([
      { HostPort: '25565' },
    ]);
  });

  it('start delegates to the container', async () => {
    const start = jest.fn().mockResolvedValue(undefined);
    getContainer.mockReturnValue({ start });
    await makeService().start('c1');
    expect(getContainer).toHaveBeenCalledWith('c1');
    expect(start).toHaveBeenCalled();
  });

  it('stop swallows an already-stopped (304) error', async () => {
    const stop = jest.fn().mockRejectedValue({ statusCode: 304 });
    getContainer.mockReturnValue({ stop });
    await expect(makeService().stop('c1')).resolves.toBeUndefined();
  });

  it('inspect maps running state', async () => {
    const inspect = jest
      .fn()
      .mockResolvedValue({ State: { Running: true, Status: 'running' } });
    getContainer.mockReturnValue({ inspect });
    await expect(makeService().inspect('c1')).resolves.toEqual({
      running: true,
      status: 'running',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ./backend test -- docker.service`
Expected: FAIL — `Cannot find module './docker.service'`.

- [ ] **Step 3: Implement `DockerService`**

Create `backend/src/servers/docker.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import Docker from 'dockerode';

export interface CreateContainerOptions {
  id: string;
  port: number;
  env: string[];
}

export interface ContainerStatus {
  running: boolean;
  status: string;
}

const CONTAINER_MC_PORT = '25565/tcp';

@Injectable()
export class DockerService {
  private readonly docker = new Docker();
  private readonly dataRoot: string;
  private readonly image: string;

  constructor(configService: ConfigService) {
    this.dataRoot = configService.get<string>('MC_DATA_ROOT') ?? '/srv/mc';
    this.image =
      configService.get<string>('MC_IMAGE') ?? 'itzg/minecraft-server';
  }

  async create(opts: CreateContainerOptions): Promise<string> {
    const dataDir = path.join(this.dataRoot, opts.id, 'data');
    await mkdir(dataDir, { recursive: true });

    const container = await this.docker.createContainer({
      Image: this.image,
      name: `mc-server-${opts.id}`,
      Env: opts.env,
      ExposedPorts: { [CONTAINER_MC_PORT]: {} },
      HostConfig: {
        Binds: [`${dataDir}:/data`],
        PortBindings: {
          [CONTAINER_MC_PORT]: [{ HostPort: String(opts.port) }],
        },
        RestartPolicy: { Name: 'no' },
      },
    });
    return container.id;
  }

  async start(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).start();
  }

  async stop(containerId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerId).stop();
    } catch (error) {
      if (!isStatus(error, 304)) throw error; // 304 = already stopped
    }
  }

  async restart(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).restart();
  }

  async remove(containerId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerId).remove({ force: true });
    } catch (error) {
      if (!isStatus(error, 404)) throw error; // 404 = already gone
    }
  }

  async inspect(containerId: string): Promise<ContainerStatus> {
    const info = await this.docker.getContainer(containerId).inspect();
    return { running: info.State.Running, status: info.State.Status };
  }
}

function isStatus(error: unknown, code: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { statusCode?: number }).statusCode === code
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ./backend test -- docker.service`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/servers/docker.service.ts backend/src/servers/docker.service.spec.ts
git commit -m "feat(servers): DockerService dockerode wrapper"
```

---

### Task 4: `ServersService` orchestration

**Files:**

- Create: `backend/src/servers/servers.service.ts`
- Test: `backend/src/servers/servers.service.spec.ts`

**Interfaces:**

- Consumes: `ServerRepository` (Task 1, injected as `serverRepository`), `DockerService` (Task 3, injected as `dockerService`), `toItzgEnv` + `Loader` (Task 2).
- Produces:
  - `interface CreateServerInput { name: string; loader: Loader; version: string; ramMb: number; port: number }`
  - `type PublicServer = Omit<ServerRecord, 'rconPassword'>` — the sanitized shape every service method returns (rconPassword stripped **inside the service**).
  - `class ServersService` with:
    - `createServer(input: CreateServerInput): Promise<PublicServer>` — generate rcon password, insert row (`creating`), create+start container, set `running`; on any failure after insert, best-effort remove container + set `failed`, then rethrow.
    - `listServers(): Promise<PublicServer[]>`
    - `getServer(id: string): Promise<PublicServer & { live: ContainerStatus | null }>` — NotFound if missing; `live` from `inspect` when a container exists, else null.
    - `start(id) / stop(id) / restart(id): Promise<PublicServer>` — NotFound if missing; error if no container yet; sets status running/stopped/running.
    - `deleteServer(id: string): Promise<void>` — best-effort stop+remove container, then delete row.

**Conventions (per user):** inject dependencies under their type-suffixed names — `serverRepository`, `dockerService`. `rconPassword` is generated with `crypto.randomBytes(16).toString('hex')`, stored, and NEVER returned: the service strips it via `toPublic()` so the controller needs no mapping logic.

- [ ] **Step 1: Write the failing test**

Create `backend/src/servers/servers.service.spec.ts`:

```typescript
import { NotFoundException } from '@nestjs/common';
import { ServersService } from './servers.service';
import { ServerRepository, ServerRecord } from './server.repository';
import { DockerService } from './docker.service';

function record(over: Partial<ServerRecord> = {}): ServerRecord {
  return {
    id: 'srv1',
    name: 'survival',
    loader: 'vanilla',
    version: '1.20.1',
    ramMb: 2048,
    port: 25565,
    rconPassword: 'pw',
    containerId: null,
    status: 'creating',
    createdAt: new Date(0),
    ...over,
  };
}

function makeRepo(): jest.Mocked<ServerRepository> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    list: jest.fn(),
    setContainer: jest.fn(),
    setStatus: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<ServerRepository>;
}

function makeDocker(): jest.Mocked<DockerService> {
  return {
    create: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    restart: jest.fn(),
    remove: jest.fn(),
    inspect: jest.fn(),
  } as unknown as jest.Mocked<DockerService>;
}

const input = {
  name: 'survival',
  loader: 'vanilla' as const,
  version: '1.20.1',
  ramMb: 2048,
  port: 25565,
};

describe('ServersService.createServer', () => {
  it('inserts, creates+starts the container, and marks it running', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.create.mockResolvedValue(record());
    docker.create.mockResolvedValue('c123');
    repo.setContainer.mockResolvedValue(
      record({ containerId: 'c123', status: 'running' }),
    );
    const svc = new ServersService(repo, docker);

    const result = await svc.createServer(input);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'survival', loader: 'vanilla' }),
    );
    // rcon password generated, non-empty, and passed to persistence
    expect(repo.create.mock.calls[0][0].rconPassword).toMatch(/^[0-9a-f]{32}$/);
    expect(docker.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'srv1', port: 25565 }),
    );
    expect(docker.start).toHaveBeenCalledWith('c123');
    expect(repo.setContainer).toHaveBeenCalledWith('srv1', 'c123', 'running');
    expect(result.status).toBe('running');
    expect(result).not.toHaveProperty('rconPassword');
  });

  it('rolls back to failed and rethrows when container start fails', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.create.mockResolvedValue(record());
    docker.create.mockResolvedValue('c123');
    docker.start.mockRejectedValue(new Error('daemon down'));
    const svc = new ServersService(repo, docker);

    await expect(svc.createServer(input)).rejects.toThrow('daemon down');
    expect(docker.remove).toHaveBeenCalledWith('c123');
    expect(repo.setStatus).toHaveBeenCalledWith('srv1', 'failed');
  });
});

describe('ServersService lifecycle', () => {
  it('start throws NotFound when the server does not exist', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    const svc = new ServersService(repo, makeDocker());
    await expect(svc.start('nope')).rejects.toThrow(NotFoundException);
  });

  it('stop stops the container and sets status stopped', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.findById.mockResolvedValue(
      record({ containerId: 'c123', status: 'running' }),
    );
    repo.setStatus.mockResolvedValue(record({ status: 'stopped' }));
    const svc = new ServersService(repo, docker);

    await svc.stop('srv1');
    expect(docker.stop).toHaveBeenCalledWith('c123');
    expect(repo.setStatus).toHaveBeenCalledWith('srv1', 'stopped');
  });

  it('deleteServer removes the container then the row', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.findById.mockResolvedValue(record({ containerId: 'c123' }));
    const svc = new ServersService(repo, docker);

    await svc.deleteServer('srv1');
    expect(docker.remove).toHaveBeenCalledWith('c123');
    expect(repo.delete).toHaveBeenCalledWith('srv1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ./backend test -- servers.service`
Expected: FAIL — `Cannot find module './servers.service'`.

- [ ] **Step 3: Implement `ServersService`**

Create `backend/src/servers/servers.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ServerRepository, ServerRecord } from './server.repository';
import { DockerService, ContainerStatus } from './docker.service';
import { toItzgEnv, Loader } from './provisioning';

export interface CreateServerInput {
  name: string;
  loader: Loader;
  version: string;
  ramMb: number;
  port: number;
}

export type PublicServer = Omit<ServerRecord, 'rconPassword'>;

function toPublic(record: ServerRecord): PublicServer {
  const { rconPassword: _omit, ...rest } = record;
  return rest;
}

@Injectable()
export class ServersService {
  constructor(
    private readonly serverRepository: ServerRepository,
    private readonly dockerService: DockerService,
  ) {}

  async createServer(input: CreateServerInput): Promise<PublicServer> {
    const rconPassword = randomBytes(16).toString('hex');
    const server = await this.serverRepository.create({
      ...input,
      rconPassword,
    });

    try {
      const env = toItzgEnv({
        loader: input.loader,
        version: input.version,
        ramMb: input.ramMb,
        rconPassword,
      });
      const containerId = await this.dockerService.create({
        id: server.id,
        port: input.port,
        env,
      });
      await this.dockerService.start(containerId);
      return toPublic(
        await this.serverRepository.setContainer(
          server.id,
          containerId,
          'running',
        ),
      );
    } catch (error) {
      await this.rollback(server.id);
      throw error;
    }
  }

  private async rollback(id: string): Promise<void> {
    const server = await this.serverRepository.findById(id);
    if (server?.containerId) {
      await this.dockerService
        .remove(server.containerId)
        .catch(() => undefined);
    }
    await this.serverRepository.setStatus(id, 'failed').catch(() => undefined);
  }

  async listServers(): Promise<PublicServer[]> {
    return (await this.serverRepository.list()).map(toPublic);
  }

  async getServer(
    id: string,
  ): Promise<PublicServer & { live: ContainerStatus | null }> {
    const server = await this.requireServer(id);
    const live = server.containerId
      ? await this.dockerService.inspect(server.containerId).catch(() => null)
      : null;
    return { ...toPublic(server), live };
  }

  async start(id: string): Promise<PublicServer> {
    const containerId = await this.requireContainer(id);
    await this.dockerService.start(containerId);
    return toPublic(await this.serverRepository.setStatus(id, 'running'));
  }

  async stop(id: string): Promise<PublicServer> {
    const containerId = await this.requireContainer(id);
    await this.dockerService.stop(containerId);
    return toPublic(await this.serverRepository.setStatus(id, 'stopped'));
  }

  async restart(id: string): Promise<PublicServer> {
    const containerId = await this.requireContainer(id);
    await this.dockerService.restart(containerId);
    return toPublic(await this.serverRepository.setStatus(id, 'running'));
  }

  async deleteServer(id: string): Promise<void> {
    const server = await this.requireServer(id);
    if (server.containerId) {
      await this.dockerService
        .remove(server.containerId)
        .catch(() => undefined);
    }
    await this.serverRepository.delete(id);
  }

  private async requireServer(id: string): Promise<ServerRecord> {
    const server = await this.serverRepository.findById(id);
    if (!server) throw new NotFoundException(`Server "${id}" not found`);
    return server;
  }

  private async requireContainer(id: string): Promise<string> {
    const server = await this.requireServer(id);
    if (!server.containerId) {
      throw new NotFoundException(`Server "${id}" has no container yet`);
    }
    return server.containerId;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ./backend test -- servers.service`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/servers/servers.service.ts backend/src/servers/servers.service.spec.ts
git commit -m "feat(servers): ServersService orchestration + rollback"
```

---

### Task 5: DTO + controller + `ServersModule` + wire into app

**Files:**

- Create: `backend/src/servers/dto/create-server.dto.ts`
- Create: `backend/src/servers/servers.controller.ts`
- Create: `backend/src/servers/servers.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**

- Consumes: `ServersService` (Task 4, injected as `serversService`), `PublicServer` (Task 4), `JwtAuthGuard` (existing, `../auth/jwt-auth.guard`).
- Produces (HTTP, all guarded) — every method is a one-line pass-through; the service already returns the sanitized `PublicServer` shape:
  - `POST /servers` → 201, `PublicServer`
  - `GET /servers` → `PublicServer[]`
  - `GET /servers/:id` → `PublicServer & { live }`
  - `POST /servers/:id/start | /stop | /restart` → `PublicServer`
  - `DELETE /servers/:id` → `{ ok: true }`

**Convention (per user):** the controller holds NO logic — no field stripping, no `.map`, no shaping. All of that lives in `ServersService`.

- [ ] **Step 1: Create the DTO**

Create `backend/src/servers/dto/create-server.dto.ts`:

```typescript
import { IsIn, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { LOADERS, Loader } from '../provisioning';

export class CreateServerDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,31}$/i, {
    message: 'name must be 1-32 chars: letters, digits, hyphens',
  })
  name!: string;

  @IsIn(LOADERS)
  loader!: Loader;

  @IsString()
  @Matches(/^[0-9][0-9A-Za-z._-]{0,31}$/, {
    message: 'version has an invalid format',
  })
  version!: string;

  @IsInt()
  @Min(512)
  @Max(32768)
  ramMb!: number;

  @IsInt()
  @Min(1024)
  @Max(65535)
  port!: number;
}
```

- [ ] **Step 2: Create the controller**

Create `backend/src/servers/servers.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ContainerStatus } from './docker.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServersService, PublicServer } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';

@UseGuards(JwtAuthGuard)
@Controller('servers')
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

  @Post()
  create(@Body() dto: CreateServerDto): Promise<PublicServer> {
    return this.serversService.createServer(dto);
  }

  @Get()
  list(): Promise<PublicServer[]> {
    return this.serversService.listServers();
  }

  @Get(':id')
  get(
    @Param('id') id: string,
  ): Promise<PublicServer & { live: ContainerStatus | null }> {
    return this.serversService.getServer(id);
  }

  @Post(':id/start')
  start(@Param('id') id: string): Promise<PublicServer> {
    return this.serversService.start(id);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string): Promise<PublicServer> {
    return this.serversService.stop(id);
  }

  @Post(':id/restart')
  restart(@Param('id') id: string): Promise<PublicServer> {
    return this.serversService.restart(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.serversService.deleteServer(id);
    return { ok: true };
  }
}
```

- [ ] **Step 3: Create the module**

Create `backend/src/servers/servers.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { ServerRepository } from './server.repository';
import { DockerService } from './docker.service';

@Module({
  imports: [PrismaModule],
  controllers: [ServersController],
  providers: [ServersService, ServerRepository, DockerService],
  exports: [ServersService],
})
export class ServersModule {}
```

- [ ] **Step 4: Wire into `app.module.ts`**

In `backend/src/app.module.ts`, add the import and list `ServersModule` in `imports`:

```typescript
import { ServersModule } from './servers/servers.module';
// ...
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  PrismaModule,
  HealthModule,
  UsersModule,
  AuthModule,
  ServersModule,
],
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter ./backend run typecheck && pnpm --filter ./backend run build`
Expected: both succeed. (No unit test here — the controller is covered end-to-end in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/servers/dto backend/src/servers/servers.controller.ts backend/src/servers/servers.module.ts backend/src/app.module.ts
git commit -m "feat(servers): guarded REST controller + module wiring"
```

---

### Task 6: `Versions` module (upstream manifests)

**Files:**

- Create: `backend/src/versions/http-fetcher.ts`
- Create: `backend/src/versions/fetchers.ts`
- Test: `backend/src/versions/fetchers.spec.ts`
- Create: `backend/src/versions/versions.service.ts`
- Test: `backend/src/versions/versions.service.spec.ts`
- Create: `backend/src/versions/versions.controller.ts`
- Create: `backend/src/versions/versions.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**

- Produces:
  - `interface HttpFetcher { getJson(url: string): Promise<unknown>; getText(url: string): Promise<string> }`
  - `class FetchHttpFetcher implements HttpFetcher` (uses global `fetch`; provided under DI token `'HTTP_FETCHER'`).
  - `parseVanilla(json): string[]`, `parsePaper(json): string[]`, `parseForge(json): string[]`, `parseNeoforge(xml: string): string[]` — each returns MC versions, newest first.
  - `class VersionsService` with `list(loader: Loader): Promise<{ loader: Loader; versions: string[] }>` (1-hour in-memory cache) — throws `BadRequestException` for an unknown loader. The service returns the final response shape so the controller stays logic-free.
  - `GET /versions/:loader` (guarded) → `{ loader, versions }` (pure pass-through to `versionsService.list`).

**NeoForge mapping rule:** NeoForge artifact versions look like `20.4.80-beta`; the leading `MAJOR.MINOR` maps to Minecraft `1.MAJOR.MINOR` (`20.4.x` → `1.20.4`). `parseNeoforge` extracts `<version>` tags from `maven-metadata.xml`, maps them, and dedupes.

- [ ] **Step 1: Write the failing parser tests**

Create `backend/src/versions/fetchers.spec.ts`:

```typescript
import {
  parseVanilla,
  parsePaper,
  parseForge,
  parseNeoforge,
} from './fetchers';

describe('version parsers', () => {
  it('parseVanilla keeps only release versions, newest first', () => {
    const json = {
      latest: { release: '1.20.1' },
      versions: [
        { id: '1.20.1', type: 'release' },
        { id: '23w31a', type: 'snapshot' },
        { id: '1.20', type: 'release' },
      ],
    };
    expect(parseVanilla(json)).toEqual(['1.20.1', '1.20']);
  });

  it('parsePaper returns versions newest first', () => {
    const json = { versions: ['1.20', '1.20.1'] };
    expect(parsePaper(json)).toEqual(['1.20.1', '1.20']);
  });

  it('parseForge extracts unique MC versions from promo keys', () => {
    const json = {
      promos: {
        '1.20.1-latest': '47.2.0',
        '1.20.1-recommended': '47.1.0',
        '1.19.2-latest': '43.2.0',
      },
    };
    expect(parseForge(json)).toEqual(['1.20.1', '1.19.2']);
  });

  it('parseNeoforge maps MAJOR.MINOR artifact versions to MC versions', () => {
    const xml = `<metadata><versioning><versions>
      <version>20.4.80-beta</version>
      <version>20.4.70</version>
      <version>20.2.88</version>
    </versions></versioning></metadata>`;
    expect(parseNeoforge(xml)).toEqual(['1.20.4', '1.20.2']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ./backend test -- fetchers`
Expected: FAIL — `Cannot find module './fetchers'`.

- [ ] **Step 3: Implement the parsers**

Create `backend/src/versions/fetchers.ts`:

```typescript
interface VanillaManifest {
  versions: { id: string; type: string }[];
}
interface PaperProject {
  versions: string[];
}
interface ForgePromotions {
  promos: Record<string, string>;
}

export function parseVanilla(json: unknown): string[] {
  const manifest = json as VanillaManifest;
  return manifest.versions.filter((v) => v.type === 'release').map((v) => v.id);
}

export function parsePaper(json: unknown): string[] {
  const project = json as PaperProject;
  return [...project.versions].reverse();
}

export function parseForge(json: unknown): string[] {
  const promos = (json as ForgePromotions).promos;
  const seen = new Set<string>();
  for (const key of Object.keys(promos)) {
    const mc = key.split('-')[0];
    if (mc) seen.add(mc);
  }
  return [...seen];
}

export function parseNeoforge(xml: string): string[] {
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
    const parts = match[1].split('.');
    if (parts.length >= 2) seen.add(`1.${parts[0]}.${parts[1]}`);
  }
  return [...seen];
}
```

- [ ] **Step 4: Run the parser test to verify it passes**

Run: `pnpm --filter ./backend test -- fetchers`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the HTTP fetcher**

Create `backend/src/versions/http-fetcher.ts`:

```typescript
export interface HttpFetcher {
  getJson(url: string): Promise<unknown>;
  getText(url: string): Promise<string>;
}

export class FetchHttpFetcher implements HttpFetcher {
  async getJson(url: string): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.json();
  }

  async getText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.text();
  }
}
```

- [ ] **Step 6: Write the failing `VersionsService` test**

Create `backend/src/versions/versions.service.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { VersionsService } from './versions.service';
import { HttpFetcher } from './http-fetcher';

function makeFetcher(): jest.Mocked<HttpFetcher> {
  return {
    getJson: jest.fn(),
    getText: jest.fn(),
  };
}

describe('VersionsService', () => {
  it('fetches + parses paper versions into the response shape', async () => {
    const http = makeFetcher();
    http.getJson.mockResolvedValue({ versions: ['1.20', '1.20.1'] });
    const svc = new VersionsService(http);
    await expect(svc.list('paper')).resolves.toEqual({
      loader: 'paper',
      versions: ['1.20.1', '1.20'],
    });
  });

  it('caches results so a second call does not refetch', async () => {
    const http = makeFetcher();
    http.getJson.mockResolvedValue({ versions: ['1.20.1'] });
    const svc = new VersionsService(http);
    await svc.list('paper');
    await svc.list('paper');
    expect(http.getJson).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown loader', async () => {
    const svc = new VersionsService(makeFetcher());
    await expect(svc.list('bogus' as never)).rejects.toThrow(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter ./backend test -- versions.service`
Expected: FAIL — `Cannot find module './versions.service'`.

- [ ] **Step 8: Implement `VersionsService`**

Create `backend/src/versions/versions.service.ts`:

```typescript
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Loader } from '../servers/provisioning';
import { HttpFetcher } from './http-fetcher';
import {
  parseForge,
  parseNeoforge,
  parsePaper,
  parseVanilla,
} from './fetchers';

export const HTTP_FETCHER = 'HTTP_FETCHER';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  at: number;
  versions: string[];
}

export interface VersionList {
  loader: Loader;
  versions: string[];
}

@Injectable()
export class VersionsService {
  private readonly cache = new Map<Loader, CacheEntry>();

  constructor(
    @Inject(HTTP_FETCHER) private readonly httpFetcher: HttpFetcher,
  ) {}

  async list(loader: Loader): Promise<VersionList> {
    const cached = this.cache.get(loader);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { loader, versions: cached.versions };
    }
    const versions = await this.fetch(loader);
    this.cache.set(loader, { at: Date.now(), versions });
    return { loader, versions };
  }

  private async fetch(loader: Loader): Promise<string[]> {
    switch (loader) {
      case 'vanilla':
        return parseVanilla(
          await this.httpFetcher.getJson(
            'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json',
          ),
        );
      case 'paper':
        return parsePaper(
          await this.httpFetcher.getJson(
            'https://api.papermc.io/v2/projects/paper',
          ),
        );
      case 'forge':
        return parseForge(
          await this.httpFetcher.getJson(
            'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
          ),
        );
      case 'neoforge':
        return parseNeoforge(
          await this.httpFetcher.getText(
            'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
          ),
        );
      default:
        throw new BadRequestException(`Unknown loader "${loader}"`);
    }
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter ./backend test -- versions.service`
Expected: PASS (3 tests).

- [ ] **Step 10: Create the controller + module**

Create `backend/src/versions/versions.controller.ts`:

```typescript
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Loader } from '../servers/provisioning';
import { VersionsService, VersionList } from './versions.service';

@UseGuards(JwtAuthGuard)
@Controller('versions')
export class VersionsController {
  constructor(private readonly versionsService: VersionsService) {}

  @Get(':loader')
  list(@Param('loader') loader: string): Promise<VersionList> {
    return this.versionsService.list(loader as Loader);
  }
}
```

Create `backend/src/versions/versions.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { VersionsController } from './versions.controller';
import { VersionsService, HTTP_FETCHER } from './versions.service';
import { FetchHttpFetcher } from './http-fetcher';

@Module({
  controllers: [VersionsController],
  providers: [
    VersionsService,
    { provide: HTTP_FETCHER, useClass: FetchHttpFetcher },
  ],
})
export class VersionsModule {}
```

- [ ] **Step 11: Wire `VersionsModule` into `app.module.ts`**

Add `import { VersionsModule } from './versions/versions.module';` and append `VersionsModule` to the `imports` array.

- [ ] **Step 12: Typecheck, then run the full unit suite**

Run: `pnpm --filter ./backend run typecheck && pnpm --filter ./backend test`
Expected: typecheck clean; all unit specs pass.

- [ ] **Step 13: Commit**

```bash
git add backend/src/versions backend/src/app.module.ts
git commit -m "feat(versions): loader version manifests behind auth"
```

---

### Task 7: End-to-end server flow + docs

**Files:**

- Create: `backend/test/servers.e2e-spec.ts`
- Modify: `backend/AGENTS.md`

**Interfaces:**

- Consumes: `AppModule`, `DockerService` (overridden with a fake), `PrismaService`, `hashPassword`, `AuthService`/login flow.

**Approach:** boot the real app, override `DockerService` with an in-memory fake (so NO real Docker daemon is needed), log in to get the `mcp_token` cookie, then drive `POST /servers` → `GET /servers/:id` → `POST /servers/:id/stop` → `DELETE /servers/:id`. Assert the response never leaks `rconPassword`, and that an unauthenticated request is rejected with 401.

- [ ] **Step 1: Write the e2e test**

Create `backend/test/servers.e2e-spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DockerService } from '../src/servers/docker.service';
import { hashPassword } from '../src/auth/password.util';

const fakeDocker: Partial<DockerService> = {
  create: jest.fn().mockResolvedValue('fake-container-id'),
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  restart: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  inspect: jest.fn().mockResolvedValue({ running: false, status: 'exited' }),
};

describe('Servers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DockerService)
      .useValue(fakeDocker)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.server.deleteMany({ where: { name: 'e2e-survival' } });
    await prisma.user.deleteMany({ where: { username: 'srv-e2e' } });
    await prisma.user.create({
      data: { username: 'srv-e2e', passwordHash: await hashPassword('pw123') },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'srv-e2e', password: 'pw123' });
    cookie = (login.headers['set-cookie'] as unknown as string[])[0];
  });

  afterAll(async () => {
    await prisma.server.deleteMany({ where: { name: 'e2e-survival' } });
    await prisma.user.deleteMany({ where: { username: 'srv-e2e' } });
    await app.close();
  });

  it('rejects unauthenticated create with 401', async () => {
    const res = await request(app.getHttpServer()).post('/servers').send({
      name: 'e2e-survival',
      loader: 'vanilla',
      version: '1.20.1',
      ramMb: 2048,
      port: 25599,
    });
    expect(res.status).toBe(401);
  });

  it('creates, fetches, stops, and deletes a server without leaking rconPassword', async () => {
    const create = await request(app.getHttpServer())
      .post('/servers')
      .set('Cookie', cookie)
      .send({
        name: 'e2e-survival',
        loader: 'vanilla',
        version: '1.20.1',
        ramMb: 2048,
        port: 25599,
      });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('running');
    expect(create.body.containerId).toBe('fake-container-id');
    expect(create.body).not.toHaveProperty('rconPassword');
    const id = create.body.id as string;

    const get = await request(app.getHttpServer())
      .get(`/servers/${id}`)
      .set('Cookie', cookie);
    expect(get.status).toBe(200);
    expect(get.body.live).toEqual({ running: false, status: 'exited' });
    expect(get.body).not.toHaveProperty('rconPassword');

    const stop = await request(app.getHttpServer())
      .post(`/servers/${id}/stop`)
      .set('Cookie', cookie);
    expect(stop.status).toBe(201);
    expect(stop.body.status).toBe('stopped');

    const del = await request(app.getHttpServer())
      .delete(`/servers/${id}`)
      .set('Cookie', cookie);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });
  });

  it('rejects an invalid loader with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/servers')
      .set('Cookie', cookie)
      .send({
        name: 'bad',
        loader: 'notaloader',
        version: '1.20.1',
        ramMb: 2048,
        port: 25601,
      });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the e2e test to verify it fails then passes**

Run: `pnpm --filter ./backend test:e2e -- servers`
Expected: initially may fail if any wiring is off; fix until PASS. No real Docker daemon is touched (DockerService is overridden).

- [ ] **Step 3: Run the FULL gate (what pre-push runs)**

Run from repo root:

```bash
pnpm --filter ./backend run typecheck
pnpm --filter ./backend run build
pnpm --filter ./backend test
pnpm --filter ./backend test:e2e
pnpm fallow
```

Expected: all green. If fallow flags `dockerode`/`@types/dockerode` or the `HTTP_FETCHER` provider as unused, add a narrow, commented `ignoreDependencies`/entry note in `.fallowrc.json` (same style as the existing `class-transformer`/`supertest` entries) — do NOT blanket-disable.

- [ ] **Step 4: Document the new modules in `backend/AGENTS.md`**

Under "Module layout", add:

```markdown
- `servers/` — `ServersController` (guarded REST) → `ServersService`
  (orchestration) → `ServerRepository` (Prisma) + `DockerService` (the ONLY
  place `dockerode` is imported). `provisioning.ts` holds the pure
  `toItzgEnv()` loader→env mapper. Each server is one `itzg/minecraft-server`
  container named `mc-server-<id>`, data bind-mounted at
  `<MC_DATA_ROOT>/<id>/data`.
- `versions/` — `VersionsController` (guarded) → `VersionsService`, which
  fetches upstream manifests (Mojang / PaperMC / Forge / NeoForge) via an
  injected `HttpFetcher` (token `HTTP_FETCHER`), cached 1h. Parsers live in
  `fetchers.ts` and are pure/unit-tested.
```

Under "Environment", add:

```markdown
Optional (servers): `MC_DATA_ROOT` (default `/srv/mc`) — host root for
per-server data bind-mounts; `MC_IMAGE` (default `itzg/minecraft-server`).
The backend needs access to the Docker socket (`/var/run/docker.sock`); run it
as a user in the `docker` group. Docker-dependent tests are opt-in only —
nothing in `pnpm test` / `pnpm test:e2e` requires a running daemon
(`DockerService` is overridden with a fake in e2e).
```

- [ ] **Step 5: Commit**

```bash
git add backend/test/servers.e2e-spec.ts backend/AGENTS.md .fallowrc.json
git commit -m "test(servers): e2e lifecycle flow + docs"
```

---

## Known limitations / deferred (not blocking Phase 1)

- **Loader build pinning:** users pick only the MC version; itzg auto-resolves the Forge/NeoForge build. Explicit build selection is a later enhancement.
- **Data-dir ownership:** `DockerService` mkdirs the bind path but leaves ownership to itzg defaults. Revisit with `PUID`/`PGID` when the file manager (Phase 2) lands.
- **RCON connectivity:** the RCON password is generated + stored now, but the console/RCON transport (publish host port vs `docker exec rcon-cli`) is decided in Plan 3 (Console + Metrics).
- **Delete keeps data:** `DELETE /servers/:id` removes the container + DB row but leaves `<MC_DATA_ROOT>/<id>/data` on disk (avoids accidental world loss; a purge flag comes with backups in Phase 2).
- **Real-daemon integration test** (`create → start → rcon → stop → remove` against a throwaway itzg container) is deferred to a `MC_DOCKER_E2E=1`-gated suite; the spec calls for it in CI.
- **Plan-1 convention retrofit:** existing `auth.controller` injects `this.auth` (should be `authService`) and sets the JWT cookie inside the controller (logic that belongs in the service). Bring it in line with the two conventions (service-suffixed deps, zero controller logic) in a small cleanup pass — not part of this plan's scope.

## Self-review notes

- Spec coverage: create-server wizard (loaders Vanilla/Paper/Forge/NeoForge + version + RAM + port) → Tasks 2/5; lifecycle start/stop/restart → Task 4/5; live version manifests → Task 6; per-server status via inspect → Task 4 `getServer`; auth on all routes → Tasks 5/6 guards + Task 7 401 test; RCON password generated server-side and never returned → Task 4 + `toResponse` strip + Task 7 assertion; DockerService is the sole dockerode boundary → Task 3. Console/metrics/logs are explicitly Plan 3, not covered here.
- Type consistency: `ServerRecord`/`CreateServerData` (Task 1) reused verbatim in Tasks 4/5; `Loader`/`LOADERS`/`toItzgEnv` (Task 2) reused in Tasks 4/5/6; `DockerService` method set (Task 3) matches the mock in Task 4 and the fake in Task 7; `HTTP_FETCHER` token defined in `versions.service.ts` and consumed in `versions.module.ts`.

```

```
