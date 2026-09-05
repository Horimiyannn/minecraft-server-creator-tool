# Console + Metrics (Phase 1 · Plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live console (stream container logs to the browser, send commands back via RCON) and live per-server metrics (CPU / RAM / disk), both over authenticated WebSockets.

**Architecture:** Two Nest socket.io gateways — `/console` and `/metrics` — sit behind the same JWT-cookie auth as the HTTP API. Both reuse the single `DockerService` wrapper (now extended with `logs`, `stats`, `rconEndpoint`, and RCON port publishing) and the existing `ServersService`. Console commands go out over the Source RCON protocol via `rcon-client`; RCON is published on the container's `25575/tcp` bound to `127.0.0.1` on an ephemeral host port (loopback-only, discovered via `inspect`, never exposed off-box). Logs stream from `docker logs --follow` (containers created with `Tty: true`, so the stream is plain text — no stdout/stderr demux).

**Tech Stack:** Nest 11 (CommonJS), `@nestjs/websockets` + `@nestjs/platform-socket.io` + `socket.io`, `rcon-client`, `cookie` (handshake parse), `dockerode` (already present), Jest + ts-jest + supertest + `socket.io-client` (tests).

## Global Constraints

- **Naming:** every injected dependency variable carries its type suffix — `serversService`, `dockerService`, `serverRepository`, `jwtService`, `socketAuthService`, `rconService`. No bare `servers`/`docker`/`rcon`.
- **Zero controller/gateway logic:** gateways route messages only — connection auth, room bookkeeping, and stream/interval lifecycle are the thinnest possible glue; all real work (RCON send, stats math, auth verify, log attach) lives in services. Gateways hold no business rules.
- **Repository boundary:** only repositories inject `PrismaService`. Gateways and new services never touch Prisma directly.
- **Docker boundary:** only `DockerService` imports `dockerode`. Everything Docker goes through it.
- **RCON secret stays server-side:** `rconPassword` is never serialized to a client, never logged, never sent over either socket. It leaves the DB only inside `ServersService.getRconTarget`, consumed by `RconService`.
- **All realtime endpoints require auth:** every socket connection is JWT-verified from the `mcp_token` httpOnly cookie during the socket.io handshake; unauthenticated sockets are disconnected before any message is processed.
- **RCON reachability:** RCON is published to `127.0.0.1` only, on an OS-assigned ephemeral host port. Never bind RCON to `0.0.0.0`.
- **Stack pins:** Nest 11 / TypeScript 5.9 / CommonJS / Prisma 6 — do not bump to Nest-that-needs-ESM, TS 7, or Prisma 7.
- **pnpm filter:** the backend package name is `mc-panel-backend`; all pnpm commands use `--filter ./backend` (path filter), never `--filter backend`.
- **LF line endings:** `.gitattributes` forces `eol=lf`; never introduce CRLF.

---

## File Structure

- `backend/src/servers/docker.service.ts` — **modify**: add `logs`, `stats`, `rconEndpoint`, `dataDir`; extend `create` (Tty + RCON port publish). New `RawStats` export.
- `backend/src/servers/servers.service.ts` — **modify**: add public `resolveContainerId` + `getRconTarget`.
- `backend/src/servers/servers.module.ts` — **modify**: export `DockerService` (shared with realtime modules).
- `backend/src/auth/socket-auth.service.ts` — **create**: verify JWT from a socket handshake cookie.
- `backend/src/auth/auth.module.ts` — **modify**: provide + export `SocketAuthService`.
- `backend/src/metrics/metrics.ts` — **create**: pure stats math (`computeCpuPct`, `computeMem`) + `dirSizeBytes`.
- `backend/src/metrics/metrics.service.ts` — **create**: `collect(containerId, dataDir)` → `ServerStats`.
- `backend/src/metrics/metrics.gateway.ts` — **create**: `/metrics` socket.io gateway.
- `backend/src/metrics/metrics.module.ts` — **create**.
- `backend/src/console/rcon.service.ts` — **create**: pooled `rcon-client` connections; `send`, `evict`.
- `backend/src/console/console.gateway.ts` — **create**: `/console` socket.io gateway (log fan-out + command routing).
- `backend/src/console/console.module.ts` — **create**.
- `backend/src/app.module.ts` — **modify**: import `ConsoleModule` + `MetricsModule`.
- `backend/test/realtime.e2e-spec.ts` — **create**: socket.io-client happy path for both namespaces.
- `backend/AGENTS.md` — **modify**: document console/ + metrics/ modules, new env, new deps.

---

## Task 1: DockerService realtime capabilities + deps

**Files:**

- Modify: `backend/src/servers/docker.service.ts`
- Test: `backend/src/servers/docker.service.spec.ts` (create)
- Modify: `backend/package.json` (deps, via pnpm add)

**Interfaces:**

- Consumes: existing `DockerService` (`create`, `inspect`), dockerode `Docker`.
- Produces:
  - `interface RawStats { cpu_stats: CpuSnapshot; precpu_stats: CpuSnapshot; memory_stats: { usage?: number; limit?: number; stats?: { cache?: number } }; }`
  - `interface CpuSnapshot { cpu_usage: { total_usage: number; percpu_usage?: number[] }; system_cpu_usage?: number; online_cpus?: number; }`
  - `DockerService.logs(containerId: string, opts?: { tail?: number }): Promise<NodeJS.ReadableStream>`
  - `DockerService.stats(containerId: string): Promise<RawStats>`
  - `DockerService.rconEndpoint(containerId: string): Promise<{ host: string; port: number }>`
  - `DockerService.dataDir(id: string): string`
  - `create` now also exposes/binds `25575/tcp` to `127.0.0.1:<ephemeral>` and sets `Tty: true`.

- [ ] **Step 1: Install dependencies**

Run:

```bash
pnpm --filter ./backend add @nestjs/websockets @nestjs/platform-socket.io socket.io rcon-client cookie
pnpm --filter ./backend add -D socket.io-client
```

Expected: `package.json` gains the runtime deps + `socket.io-client` devDep. (`cookie` ships its own types; no `@types/cookie` needed.)

- [ ] **Step 2: Write the failing test**

Create `backend/src/servers/docker.service.spec.ts`:

```typescript
import { DockerService, RawStats } from './docker.service';

// A fake dockerode container + client so we assert call args without a daemon.
function makeService(container: Record<string, jest.Mock>): {
  service: DockerService;
  getContainer: jest.Mock;
} {
  const getContainer = jest.fn().mockReturnValue(container);
  const configService = { get: jest.fn().mockReturnValue(undefined) };
  const service = new DockerService(configService as never);
  // Replace the private dockerode client with our fake.
  (service as unknown as { docker: { getContainer: jest.Mock } }).docker = {
    getContainer,
  };
  return { service, getContainer };
}

describe('DockerService.logs', () => {
  it('requests a following, combined stdout+stderr stream', async () => {
    const logs = jest.fn().mockResolvedValue('STREAM');
    const { service, getContainer } = makeService({ logs });
    const stream = await service.logs('c1', { tail: 50 });
    expect(getContainer).toHaveBeenCalledWith('c1');
    expect(logs).toHaveBeenCalledWith({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 50,
      timestamps: false,
    });
    expect(stream).toBe('STREAM');
  });

  it('defaults tail to 200', async () => {
    const logs = jest.fn().mockResolvedValue('S');
    const { service } = makeService({ logs });
    await service.logs('c1');
    expect(logs).toHaveBeenCalledWith(expect.objectContaining({ tail: 200 }));
  });
});

describe('DockerService.stats', () => {
  it('returns a one-shot (non-streaming) stats snapshot', async () => {
    const raw: RawStats = {
      cpu_stats: { cpu_usage: { total_usage: 0 } },
      precpu_stats: { cpu_usage: { total_usage: 0 } },
      memory_stats: {},
    };
    const stats = jest.fn().mockResolvedValue(raw);
    const { service } = makeService({ stats });
    const result = await service.stats('c1');
    expect(stats).toHaveBeenCalledWith({ stream: false });
    expect(result).toBe(raw);
  });
});

describe('DockerService.rconEndpoint', () => {
  it('reads the loopback host port bound to 25575/tcp', async () => {
    const inspect = jest.fn().mockResolvedValue({
      NetworkSettings: {
        Ports: { '25575/tcp': [{ HostIp: '127.0.0.1', HostPort: '49222' }] },
      },
    });
    const { service } = makeService({ inspect });
    await expect(service.rconEndpoint('c1')).resolves.toEqual({
      host: '127.0.0.1',
      port: 49222,
    });
  });

  it('throws when RCON is not published', async () => {
    const inspect = jest
      .fn()
      .mockResolvedValue({ NetworkSettings: { Ports: {} } });
    const { service } = makeService({ inspect });
    await expect(service.rconEndpoint('c1')).rejects.toThrow('RCON port');
  });
});

describe('DockerService.create', () => {
  it('publishes RCON on loopback, sets a TTY, and keeps the MC port', async () => {
    const createContainer = jest.fn().mockResolvedValue({ id: 'cNEW' });
    const getContainer = jest.fn();
    const configService = { get: jest.fn().mockReturnValue(undefined) };
    const service = new DockerService(configService as never);
    (service as unknown as { docker: unknown }).docker = {
      createContainer,
      getContainer,
    };
    const id = await service.create({
      id: 'srv1',
      port: 25599,
      env: ['EULA=TRUE'],
    });
    expect(id).toBe('cNEW');
    const arg = createContainer.mock.calls[0][0];
    expect(arg.Tty).toBe(true);
    expect(arg.ExposedPorts).toMatchObject({
      '25565/tcp': {},
      '25575/tcp': {},
    });
    expect(arg.HostConfig.PortBindings['25565/tcp']).toEqual([
      { HostPort: '25599' },
    ]);
    expect(arg.HostConfig.PortBindings['25575/tcp']).toEqual([
      { HostIp: '127.0.0.1', HostPort: '' },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter ./backend exec jest docker.service.spec`
Expected: FAIL — `logs`/`stats`/`rconEndpoint` not a function; `create` assertions on `Tty`/`25575` fail.

- [ ] **Step 4: Implement the changes**

Edit `backend/src/servers/docker.service.ts`. Add near the existing interfaces:

```typescript
interface CpuSnapshot {
  cpu_usage: { total_usage: number; percpu_usage?: number[] };
  system_cpu_usage?: number;
  online_cpus?: number;
}

export interface RawStats {
  cpu_stats: CpuSnapshot;
  precpu_stats: CpuSnapshot;
  memory_stats: { usage?: number; limit?: number; stats?: { cache?: number } };
}

const CONTAINER_RCON_PORT = '25575/tcp';
```

In `create`, change the `ExposedPorts`, `HostConfig`, and add `Tty`:

```typescript
const container = await this.docker.createContainer({
  Image: this.image,
  name: `mc-server-${opts.id}`,
  Env: opts.env,
  Tty: true, // plain-text log stream (no stdout/stderr multiplexing)
  ExposedPorts: { [CONTAINER_MC_PORT]: {}, [CONTAINER_RCON_PORT]: {} },
  HostConfig: {
    Binds: [`${dataDir}:/data`],
    PortBindings: {
      [CONTAINER_MC_PORT]: [{ HostPort: String(opts.port) }],
      // RCON: loopback only, OS-assigned host port (read back via inspect).
      [CONTAINER_RCON_PORT]: [{ HostIp: '127.0.0.1', HostPort: '' }],
    },
    RestartPolicy: { Name: 'no' },
  },
});
return container.id;
```

Add the new methods (after `inspect`):

```typescript
  dataDir(id: string): string {
    return path.join(this.dataRoot, id, 'data');
  }

  async logs(
    containerId: string,
    opts: { tail?: number } = {},
  ): Promise<NodeJS.ReadableStream> {
    const stream = await this.docker.getContainer(containerId).logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: opts.tail ?? 200,
      timestamps: false,
    });
    return stream as unknown as NodeJS.ReadableStream;
  }

  async stats(containerId: string): Promise<RawStats> {
    const raw = await this.docker.getContainer(containerId).stats({
      stream: false,
    });
    return raw as unknown as RawStats;
  }

  async rconEndpoint(
    containerId: string,
  ): Promise<{ host: string; port: number }> {
    const info = await this.docker.getContainer(containerId).inspect();
    const binding = info.NetworkSettings?.Ports?.[CONTAINER_RCON_PORT]?.[0];
    if (!binding?.HostPort) {
      throw new Error('RCON port is not published for this container');
    }
    return { host: '127.0.0.1', port: Number(binding.HostPort) };
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter ./backend exec jest docker.service.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/pnpm-lock.yaml backend/src/servers/docker.service.ts backend/src/servers/docker.service.spec.ts
git commit -m "feat(backend): DockerService logs/stats/rconEndpoint + loopback RCON publish"
```

---

## Task 2: MetricsService (stats math + disk)

**Files:**

- Create: `backend/src/metrics/metrics.ts`
- Create: `backend/src/metrics/metrics.service.ts`
- Test: `backend/src/metrics/metrics.ts` covered via `backend/src/metrics/metrics.spec.ts` (create)
- Test: `backend/src/metrics/metrics.service.spec.ts` (create)

**Interfaces:**

- Consumes: `DockerService.stats` → `RawStats`; `RawStats` type from Task 1.
- Produces:
  - `interface ServerStats { cpuPct: number; memUsedMb: number; memLimitMb: number; diskMb: number; }`
  - `computeCpuPct(raw: RawStats): number`
  - `computeMem(raw: RawStats): { usedMb: number; limitMb: number }`
  - `dirSizeBytes(dir: string): Promise<number>`
  - `MetricsService.collect(containerId: string, dataDir: string): Promise<ServerStats>`

- [ ] **Step 1: Write the failing test for the pure math**

Create `backend/src/metrics/metrics.spec.ts`:

```typescript
import { computeCpuPct, computeMem } from './metrics';
import { RawStats } from '../servers/docker.service';

function raw(over: Partial<RawStats> = {}): RawStats {
  return {
    cpu_stats: {
      cpu_usage: { total_usage: 200 },
      system_cpu_usage: 2000,
      online_cpus: 4,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 100 },
      system_cpu_usage: 1000,
    },
    memory_stats: { usage: 600 * 1024 * 1024, limit: 2048 * 1024 * 1024 },
    ...over,
  };
}

describe('computeCpuPct', () => {
  it('scales the cpu delta over the system delta by online cpus', () => {
    // cpuDelta=100, sysDelta=1000 -> 0.1 * 4 * 100 = 40%
    expect(computeCpuPct(raw())).toBeCloseTo(40);
  });

  it('is 0 when the system delta is 0 (first sample)', () => {
    expect(
      computeCpuPct(
        raw({
          cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
          precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
        }),
      ),
    ).toBe(0);
  });

  it('falls back to percpu length when online_cpus is absent', () => {
    expect(
      computeCpuPct(
        raw({
          cpu_stats: {
            cpu_usage: { total_usage: 200, percpu_usage: [1, 2] },
            system_cpu_usage: 2000,
          },
        }),
      ),
    ).toBeCloseTo(20); // 0.1 * 2 * 100
  });
});

describe('computeMem', () => {
  it('subtracts page cache and reports MiB', () => {
    const r = raw({
      memory_stats: {
        usage: 600 * 1024 * 1024,
        limit: 2048 * 1024 * 1024,
        stats: { cache: 100 * 1024 * 1024 },
      },
    });
    expect(computeMem(r)).toEqual({ usedMb: 500, limitMb: 2048 });
  });

  it('handles missing fields as zero', () => {
    expect(computeMem(raw({ memory_stats: {} }))).toEqual({
      usedMb: 0,
      limitMb: 0,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./backend exec jest metrics.spec`
Expected: FAIL — module `./metrics` not found.

- [ ] **Step 3: Implement the pure math**

Create `backend/src/metrics/metrics.ts`:

```typescript
import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { RawStats } from '../servers/docker.service';

const MB = 1024 * 1024;

export interface ServerStats {
  cpuPct: number;
  memUsedMb: number;
  memLimitMb: number;
  diskMb: number;
}

export function computeCpuPct(raw: RawStats): number {
  const cpuDelta =
    raw.cpu_stats.cpu_usage.total_usage -
    raw.precpu_stats.cpu_usage.total_usage;
  const sysDelta =
    (raw.cpu_stats.system_cpu_usage ?? 0) -
    (raw.precpu_stats.system_cpu_usage ?? 0);
  if (sysDelta <= 0 || cpuDelta < 0) return 0;
  const cpus =
    raw.cpu_stats.online_cpus ??
    raw.cpu_stats.cpu_usage.percpu_usage?.length ??
    1;
  return (cpuDelta / sysDelta) * cpus * 100;
}

export function computeMem(raw: RawStats): {
  usedMb: number;
  limitMb: number;
} {
  const usage = raw.memory_stats.usage ?? 0;
  const cache = raw.memory_stats.stats?.cache ?? 0;
  const limit = raw.memory_stats.limit ?? 0;
  return {
    usedMb: Math.round(Math.max(0, usage - cache) / MB),
    limitMb: Math.round(limit / MB),
  };
}

export async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0; // dir may not exist yet
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full);
    } else if (entry.isFile()) {
      total += (await stat(full)).size;
    }
  }
  return total;
}
```

- [ ] **Step 4: Run to verify the math passes**

Run: `pnpm --filter ./backend exec jest metrics.spec`
Expected: PASS.

- [ ] **Step 5: Write the failing test for MetricsService.collect**

Create `backend/src/metrics/metrics.service.spec.ts`:

```typescript
import { MetricsService } from './metrics.service';
import { DockerService, RawStats } from '../servers/docker.service';

const raw: RawStats = {
  cpu_stats: {
    cpu_usage: { total_usage: 200 },
    system_cpu_usage: 2000,
    online_cpus: 4,
  },
  precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
  memory_stats: { usage: 600 * 1024 * 1024, limit: 2048 * 1024 * 1024 },
};

describe('MetricsService.collect', () => {
  it('combines container stats with data-dir disk usage', async () => {
    const dockerService = {
      stats: jest.fn().mockResolvedValue(raw),
    } as unknown as jest.Mocked<DockerService>;
    const service = new MetricsService(dockerService);
    // Point disk at this repo dir so dirSizeBytes returns > 0.
    const result = await service.collect('c1', __dirname);
    expect(dockerService.stats).toHaveBeenCalledWith('c1');
    expect(result.cpuPct).toBeCloseTo(40);
    expect(result.memUsedMb).toBe(600);
    expect(result.memLimitMb).toBe(2048);
    expect(result.diskMb).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter ./backend exec jest metrics.service.spec`
Expected: FAIL — `metrics.service` not found.

- [ ] **Step 7: Implement MetricsService**

Create `backend/src/metrics/metrics.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { DockerService } from '../servers/docker.service';
import {
  computeCpuPct,
  computeMem,
  dirSizeBytes,
  ServerStats,
} from './metrics';

@Injectable()
export class MetricsService {
  constructor(private readonly dockerService: DockerService) {}

  async collect(containerId: string, dataDir: string): Promise<ServerStats> {
    const raw = await this.dockerService.stats(containerId);
    const mem = computeMem(raw);
    const diskBytes = await dirSizeBytes(dataDir);
    return {
      cpuPct: Math.round(computeCpuPct(raw) * 10) / 10,
      memUsedMb: mem.usedMb,
      memLimitMb: mem.limitMb,
      diskMb: Math.round(diskBytes / (1024 * 1024)),
    };
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm --filter ./backend exec jest metrics.service.spec metrics.spec`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/metrics/metrics.ts backend/src/metrics/metrics.service.ts backend/src/metrics/metrics.spec.ts backend/src/metrics/metrics.service.spec.ts
git commit -m "feat(backend): MetricsService — cpu/mem/disk collection"
```

---

## Task 3: SocketAuthService (WS handshake auth)

**Files:**

- Create: `backend/src/auth/socket-auth.service.ts`
- Modify: `backend/src/auth/auth.module.ts`
- Test: `backend/src/auth/socket-auth.service.spec.ts` (create)

**Interfaces:**

- Consumes: `JwtService` (already in AuthModule), `JwtPayload` from `auth.service`.
- Produces:
  - `SocketAuthService.authenticate(client: { handshake: { headers: { cookie?: string } } }): JwtPayload` — returns the payload or throws `WsException`.
  - `SocketAuthService` exported from `AuthModule`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/auth/socket-auth.service.spec.ts`:

```typescript
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { SocketAuthService } from './socket-auth.service';

function client(cookie?: string) {
  return { handshake: { headers: cookie ? { cookie } : {} } };
}

describe('SocketAuthService.authenticate', () => {
  const jwtService = new JwtService({ secret: 'test-secret' });
  const service = new SocketAuthService(jwtService);

  it('returns the payload for a valid mcp_token cookie', () => {
    const token = jwtService.sign({ sub: 1, username: 'admin' });
    const payload = service.authenticate(client(`mcp_token=${token}; other=x`));
    expect(payload.username).toBe('admin');
    expect(payload.sub).toBe(1);
  });

  it('throws WsException when no cookie header is present', () => {
    expect(() => service.authenticate(client())).toThrow(WsException);
  });

  it('throws WsException when mcp_token is absent', () => {
    expect(() => service.authenticate(client('other=x'))).toThrow(WsException);
  });

  it('throws WsException for an invalid token', () => {
    expect(() => service.authenticate(client('mcp_token=garbage'))).toThrow(
      WsException,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./backend exec jest socket-auth.service.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement SocketAuthService**

Create `backend/src/auth/socket-auth.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { parse } from 'cookie';
import { JwtPayload } from './auth.service';

interface HandshakeLike {
  handshake: { headers: { cookie?: string } };
}

@Injectable()
export class SocketAuthService {
  constructor(private readonly jwtService: JwtService) {}

  authenticate(client: HandshakeLike): JwtPayload {
    const header = client.handshake.headers.cookie;
    const token = header ? parse(header)['mcp_token'] : undefined;
    if (!token) {
      throw new WsException('Not authenticated');
    }
    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new WsException('Invalid or expired token');
    }
  }
}
```

- [ ] **Step 4: Wire it into AuthModule**

Edit `backend/src/auth/auth.module.ts` — add `SocketAuthService` to `providers` and `exports`:

```typescript
import { SocketAuthService } from './socket-auth.service';
// ...
  providers: [AuthService, JwtAuthGuard, JwtStrategy /* existing */, SocketAuthService],
  exports: [AuthService, JwtAuthGuard, SocketAuthService],
```

(Match the existing provider/export list; only add `SocketAuthService`. If the module already exports `JwtModule`, leave that as-is.)

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter ./backend exec jest socket-auth.service.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/auth/socket-auth.service.ts backend/src/auth/socket-auth.service.spec.ts backend/src/auth/auth.module.ts
git commit -m "feat(backend): SocketAuthService — JWT-cookie auth for WebSocket handshakes"
```

---

## Task 4: ServersService realtime accessors + module export

**Files:**

- Modify: `backend/src/servers/servers.service.ts`
- Modify: `backend/src/servers/servers.module.ts`
- Test: `backend/src/servers/servers.service.spec.ts` (extend)

**Interfaces:**

- Consumes: existing private `requireServer`/`requireContainer`; `DockerService.rconEndpoint`.
- Produces:
  - `ServersService.resolveContainerId(id: string): Promise<string>`
  - `ServersService.getRconTarget(id: string): Promise<{ host: string; port: number; password: string }>`
  - `ServersModule` exports `DockerService` (in addition to `ServersService`).

- [ ] **Step 1: Write the failing test**

Append to `backend/src/servers/servers.service.spec.ts`:

```typescript
describe('ServersService.getRconTarget', () => {
  it('returns the rcon endpoint plus the stored password', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.findById.mockResolvedValue(
      record({ containerId: 'c123', rconPassword: 'secret-pw' }),
    );
    (docker as unknown as { rconEndpoint: jest.Mock }).rconEndpoint = jest
      .fn()
      .mockResolvedValue({ host: '127.0.0.1', port: 49222 });
    const service = new ServersService(repo, docker);
    await expect(service.getRconTarget('srv1')).resolves.toEqual({
      host: '127.0.0.1',
      port: 49222,
      password: 'secret-pw',
    });
  });

  it('throws NotFound when the server has no container', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.findById.mockResolvedValue(record({ containerId: null }));
    const service = new ServersService(repo, docker);
    await expect(service.getRconTarget('srv1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ServersService.resolveContainerId', () => {
  it('returns the container id', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.findById.mockResolvedValue(record({ containerId: 'c123' }));
    const service = new ServersService(repo, docker);
    await expect(service.resolveContainerId('srv1')).resolves.toBe('c123');
  });
});
```

Also add `rconEndpoint: jest.fn()` to the `makeDocker()` mock object so the type stays consistent.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./backend exec jest servers.service.spec`
Expected: FAIL — `getRconTarget`/`resolveContainerId` not functions.

- [ ] **Step 3: Implement the accessors**

Edit `backend/src/servers/servers.service.ts`. Add public methods (near the private helpers):

```typescript
  async resolveContainerId(id: string): Promise<string> {
    return this.requireContainer(id);
  }

  async getRconTarget(
    id: string,
  ): Promise<{ host: string; port: number; password: string }> {
    const server = await this.requireServer(id);
    if (!server.containerId) {
      throw new NotFoundException(`Server "${id}" has no container yet`);
    }
    const { host, port } = await this.dockerService.rconEndpoint(
      server.containerId,
    );
    return { host, port, password: server.rconPassword };
  }
```

- [ ] **Step 4: Export DockerService from ServersModule**

Edit `backend/src/servers/servers.module.ts` — add `DockerService` to `exports`:

```typescript
  exports: [ServersService, DockerService],
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter ./backend exec jest servers.service.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/servers/servers.service.ts backend/src/servers/servers.service.spec.ts backend/src/servers/servers.module.ts
git commit -m "feat(backend): ServersService.getRconTarget/resolveContainerId; export DockerService"
```

---

## Task 5: RconService (pooled command channel)

**Files:**

- Create: `backend/src/console/rcon.service.ts`
- Test: `backend/src/console/rcon.service.spec.ts` (create)

**Interfaces:**

- Consumes: `ServersService.getRconTarget`; `rcon-client` `Rcon.connect`.
- Produces:
  - `RconService.send(serverId: string, command: string): Promise<string>`
  - `RconService.evict(serverId: string): void`

- [ ] **Step 1: Write the failing test**

Create `backend/src/console/rcon.service.spec.ts`:

```typescript
import { RconService } from './rcon.service';
import { ServersService } from '../servers/servers.service';
import { Rcon } from 'rcon-client';

jest.mock('rcon-client');

const target = { host: '127.0.0.1', port: 49222, password: 'pw' };

function makeServers(): jest.Mocked<ServersService> {
  return {
    getRconTarget: jest.fn().mockResolvedValue(target),
  } as unknown as jest.Mocked<ServersService>;
}

function fakeRcon(send: jest.Mock) {
  return { send, end: jest.fn().mockResolvedValue(undefined), on: jest.fn() };
}

describe('RconService.send', () => {
  const connect = Rcon.connect as jest.Mock;

  beforeEach(() => connect.mockReset());

  it('connects once and reuses the pooled connection', async () => {
    const send = jest.fn().mockResolvedValue('There are 0 players');
    connect.mockResolvedValue(fakeRcon(send));
    const serversService = makeServers();
    const service = new RconService(serversService);

    const first = await service.send('srv1', 'list');
    const second = await service.send('srv1', 'list');

    expect(first).toBe('There are 0 players');
    expect(second).toBe('There are 0 players');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 49222,
      password: 'pw',
    });
  });

  it('evicts the connection and rethrows when send fails', async () => {
    const send = jest.fn().mockRejectedValue(new Error('boom'));
    connect.mockResolvedValue(fakeRcon(send));
    const service = new RconService(makeServers());

    await expect(service.send('srv1', 'list')).rejects.toThrow('boom');
    // Next send reconnects (pool was evicted).
    const send2 = jest.fn().mockResolvedValue('ok');
    connect.mockResolvedValue(fakeRcon(send2));
    await expect(service.send('srv1', 'list')).resolves.toBe('ok');
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./backend exec jest rcon.service.spec`
Expected: FAIL — `rcon.service` not found.

- [ ] **Step 3: Implement RconService**

Create `backend/src/console/rcon.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Rcon } from 'rcon-client';
import { ServersService } from '../servers/servers.service';

@Injectable()
export class RconService {
  private readonly pool = new Map<string, Rcon>();

  constructor(private readonly serversService: ServersService) {}

  async send(serverId: string, command: string): Promise<string> {
    const rcon = await this.connection(serverId);
    try {
      return await rcon.send(command);
    } catch (error) {
      this.evict(serverId);
      throw error;
    }
  }

  evict(serverId: string): void {
    const rcon = this.pool.get(serverId);
    if (rcon) {
      this.pool.delete(serverId);
      void rcon.end().catch(() => undefined);
    }
  }

  private async connection(serverId: string): Promise<Rcon> {
    const existing = this.pool.get(serverId);
    if (existing) return existing;
    const { host, port, password } =
      await this.serversService.getRconTarget(serverId);
    const rcon = await Rcon.connect({ host, port, password });
    rcon.on('end', () => this.pool.delete(serverId));
    this.pool.set(serverId, rcon);
    return rcon;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter ./backend exec jest rcon.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/console/rcon.service.ts backend/src/console/rcon.service.spec.ts
git commit -m "feat(backend): RconService — pooled rcon-client command channel"
```

---

## Task 6: ConsoleGateway + MetricsGateway + modules

**Files:**

- Create: `backend/src/console/console.gateway.ts`
- Create: `backend/src/console/console.module.ts`
- Create: `backend/src/metrics/metrics.gateway.ts`
- Create: `backend/src/metrics/metrics.module.ts`
- Test: `backend/src/console/console.gateway.spec.ts` (create)
- Test: `backend/src/metrics/metrics.gateway.spec.ts` (create)

**Interfaces:**

- Consumes: `SocketAuthService.authenticate`, `DockerService.logs`/`dataDir`, `ServersService.resolveContainerId`, `RconService.send`, `MetricsService.collect`.
- Produces (message contracts, both namespaces require the `mcp_token` cookie at handshake):
  - `/console` — client emits `join` `{ serverId }` → server streams `log` `{ serverId, line }`; client emits `command` `{ serverId, command }` → server replies `output` `{ serverId, output }` (or `error` `{ message }`).
  - `/metrics` — client emits `join` `{ serverId }` → server emits `stats` `ServerStats & { serverId }` every 2s; `leave` `{ serverId }` or disconnect stops it.
- Note: gateways contain only routing + lifecycle glue; log line-splitting/fan-out and stats intervals are the minimum wiring, all payloads produced by services.

- [ ] **Step 1: Write the failing test for ConsoleGateway**

Create `backend/src/console/console.gateway.spec.ts`:

```typescript
import { ConsoleGateway } from './console.gateway';
import { SocketAuthService } from '../auth/socket-auth.service';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';
import { RconService } from './rcon.service';

function makeDeps() {
  const socketAuthService = {
    authenticate: jest.fn().mockReturnValue({ sub: 1, username: 'admin' }),
  } as unknown as jest.Mocked<SocketAuthService>;
  const dockerService = {
    logs: jest.fn(),
  } as unknown as jest.Mocked<DockerService>;
  const serversService = {
    resolveContainerId: jest.fn().mockResolvedValue('c1'),
  } as unknown as jest.Mocked<ServersService>;
  const rconService = {
    send: jest.fn().mockResolvedValue('cmd-output'),
  } as unknown as jest.Mocked<RconService>;
  return { socketAuthService, dockerService, serversService, rconService };
}

function fakeClient() {
  return {
    handshake: { headers: { cookie: 'mcp_token=x' } },
    data: {} as Record<string, unknown>,
    disconnect: jest.fn(),
    emit: jest.fn(),
  };
}

describe('ConsoleGateway', () => {
  it('disconnects a client that fails authentication', () => {
    const deps = makeDeps();
    deps.socketAuthService.authenticate = jest.fn(() => {
      throw new Error('no');
    });
    const gateway = new ConsoleGateway(
      deps.socketAuthService,
      deps.dockerService,
      deps.serversService,
      deps.rconService,
    );
    const client = fakeClient();
    gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('routes a command through RconService and replies with output', async () => {
    const deps = makeDeps();
    const gateway = new ConsoleGateway(
      deps.socketAuthService,
      deps.dockerService,
      deps.serversService,
      deps.rconService,
    );
    const client = fakeClient();
    await gateway.command(client as never, {
      serverId: 'srv1',
      command: 'list',
    });
    expect(deps.rconService.send).toHaveBeenCalledWith('srv1', 'list');
    expect(client.emit).toHaveBeenCalledWith('output', {
      serverId: 'srv1',
      output: 'cmd-output',
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./backend exec jest console.gateway.spec`
Expected: FAIL — `console.gateway` not found.

- [ ] **Step 3: Implement ConsoleGateway**

Create `backend/src/console/console.gateway.ts`:

```typescript
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SocketAuthService } from '../auth/socket-auth.service';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';
import { RconService } from './rcon.service';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';

interface LogStream {
  stream: NodeJS.ReadableStream;
  buffer: string;
  count: number;
}

@WebSocketGateway({
  namespace: '/console',
  cors: { origin: FRONTEND_ORIGIN, credentials: true },
})
export class ConsoleGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() private readonly server!: Server;
  private readonly streams = new Map<string, LogStream>();

  constructor(
    private readonly socketAuthService: SocketAuthService,
    private readonly dockerService: DockerService,
    private readonly serversService: ServersService,
    private readonly rconService: RconService,
  ) {}

  handleConnection(client: Socket): void {
    try {
      client.data.user = this.socketAuthService.authenticate(client);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    for (const room of client.rooms) {
      if (room.startsWith('server:'))
        this.release(room.slice('server:'.length));
    }
  }

  @SubscribeMessage('join')
  async join(client: Socket, payload: { serverId: string }): Promise<void> {
    const { serverId } = payload;
    await client.join(`server:${serverId}`);
    await this.attach(serverId);
  }

  @SubscribeMessage('command')
  async command(
    client: Socket,
    payload: { serverId: string; command: string },
  ): Promise<void> {
    try {
      const output = await this.rconService.send(
        payload.serverId,
        payload.command,
      );
      client.emit('output', { serverId: payload.serverId, output });
    } catch (error) {
      client.emit('error', {
        message: error instanceof Error ? error.message : 'command failed',
      });
    }
  }

  private async attach(serverId: string): Promise<void> {
    const existing = this.streams.get(serverId);
    if (existing) {
      existing.count += 1;
      return;
    }
    const containerId = await this.serversService.resolveContainerId(serverId);
    const stream = await this.dockerService.logs(containerId, { tail: 200 });
    const entry: LogStream = { stream, buffer: '', count: 1 };
    this.streams.set(serverId, entry);
    stream.on('data', (chunk: Buffer) => this.fanOut(serverId, entry, chunk));
    stream.on('end', () => this.streams.delete(serverId));
    stream.on('error', () => this.streams.delete(serverId));
  }

  private fanOut(serverId: string, entry: LogStream, chunk: Buffer): void {
    entry.buffer += chunk.toString('utf8');
    const lines = entry.buffer.split('\n');
    entry.buffer = lines.pop() ?? '';
    for (const line of lines) {
      this.server.to(`server:${serverId}`).emit('log', { serverId, line });
    }
  }

  private release(serverId: string): void {
    const entry = this.streams.get(serverId);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count <= 0) {
      this.streams.delete(serverId);
      (entry.stream as unknown as { destroy?: () => void }).destroy?.();
    }
  }
}
```

- [ ] **Step 4: Run to verify ConsoleGateway passes**

Run: `pnpm --filter ./backend exec jest console.gateway.spec`
Expected: PASS.

- [ ] **Step 5: Write the failing test for MetricsGateway**

Create `backend/src/metrics/metrics.gateway.spec.ts`:

```typescript
import { MetricsGateway } from './metrics.gateway';
import { SocketAuthService } from '../auth/socket-auth.service';
import { MetricsService } from './metrics.service';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';

function makeGateway() {
  const socketAuthService = {
    authenticate: jest.fn().mockReturnValue({ sub: 1, username: 'admin' }),
  } as unknown as jest.Mocked<SocketAuthService>;
  const metricsService = {
    collect: jest.fn().mockResolvedValue({
      cpuPct: 12,
      memUsedMb: 500,
      memLimitMb: 2048,
      diskMb: 42,
    }),
  } as unknown as jest.Mocked<MetricsService>;
  const dockerService = {
    dataDir: jest.fn().mockReturnValue('/srv/mc/srv1/data'),
  } as unknown as jest.Mocked<DockerService>;
  const serversService = {
    resolveContainerId: jest.fn().mockResolvedValue('c1'),
  } as unknown as jest.Mocked<ServersService>;
  const gateway = new MetricsGateway(
    socketAuthService,
    metricsService,
    dockerService,
    serversService,
  );
  const emit = jest.fn();
  (gateway as unknown as { server: unknown }).server = {
    to: () => ({ emit }),
  };
  return { gateway, emit, metricsService };
}

function fakeClient() {
  return {
    handshake: { headers: { cookie: 'mcp_token=x' } },
    data: {} as Record<string, unknown>,
    disconnect: jest.fn(),
    join: jest.fn(),
    rooms: new Set<string>(),
  };
}

describe('MetricsGateway', () => {
  afterEach(() => jest.useRealTimers());

  it('emits a stats tick after joining', async () => {
    jest.useFakeTimers();
    const { gateway, emit, metricsService } = makeGateway();
    const client = fakeClient();
    await gateway.join(client as never, { serverId: 'srv1' });
    await jest.advanceTimersByTimeAsync(2000);
    expect(metricsService.collect).toHaveBeenCalledWith(
      'c1',
      '/srv/mc/srv1/data',
    );
    expect(emit).toHaveBeenCalledWith(
      'stats',
      expect.objectContaining({ serverId: 'srv1', cpuPct: 12 }),
    );
    gateway.leave(client as never, { serverId: 'srv1' });
  });

  it('stops polling when the last subscriber leaves', async () => {
    jest.useFakeTimers();
    const { gateway, metricsService } = makeGateway();
    const client = fakeClient();
    await gateway.join(client as never, { serverId: 'srv1' });
    gateway.leave(client as never, { serverId: 'srv1' });
    metricsService.collect.mockClear();
    await jest.advanceTimersByTimeAsync(4000);
    expect(metricsService.collect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter ./backend exec jest metrics.gateway.spec`
Expected: FAIL — `metrics.gateway` not found.

- [ ] **Step 7: Implement MetricsGateway**

Create `backend/src/metrics/metrics.gateway.ts`:

```typescript
import {
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SocketAuthService } from '../auth/socket-auth.service';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';
import { MetricsService } from './metrics.service';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
const POLL_MS = 2000;

interface Poll {
  timer: NodeJS.Timeout;
  count: number;
}

@WebSocketGateway({
  namespace: '/metrics',
  cors: { origin: FRONTEND_ORIGIN, credentials: true },
})
export class MetricsGateway implements OnGatewayConnection {
  @WebSocketServer() private readonly server!: Server;
  private readonly polls = new Map<string, Poll>();

  constructor(
    private readonly socketAuthService: SocketAuthService,
    private readonly metricsService: MetricsService,
    private readonly dockerService: DockerService,
    private readonly serversService: ServersService,
  ) {}

  handleConnection(client: Socket): void {
    try {
      client.data.user = this.socketAuthService.authenticate(client);
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('join')
  async join(client: Socket, payload: { serverId: string }): Promise<void> {
    const { serverId } = payload;
    await client.join(`server:${serverId}`);
    const existing = this.polls.get(serverId);
    if (existing) {
      existing.count += 1;
      return;
    }
    const containerId = await this.serversService.resolveContainerId(serverId);
    const dataDir = this.dockerService.dataDir(serverId);
    const timer = setInterval(() => {
      void this.tick(serverId, containerId, dataDir);
    }, POLL_MS);
    this.polls.set(serverId, { timer, count: 1 });
  }

  @SubscribeMessage('leave')
  leave(client: Socket, payload: { serverId: string }): void {
    this.release(payload.serverId);
  }

  private async tick(
    serverId: string,
    containerId: string,
    dataDir: string,
  ): Promise<void> {
    try {
      const stats = await this.metricsService.collect(containerId, dataDir);
      this.server
        .to(`server:${serverId}`)
        .emit('stats', { serverId, ...stats });
    } catch {
      // transient (container restarting) — skip this tick
    }
  }

  private release(serverId: string): void {
    const poll = this.polls.get(serverId);
    if (!poll) return;
    poll.count -= 1;
    if (poll.count <= 0) {
      clearInterval(poll.timer);
      this.polls.delete(serverId);
    }
  }
}
```

> Note: `metrics.gateway.spec` calls `dataDir(serverId)` (id → path), matching `DockerService.dataDir` from Task 1.

- [ ] **Step 8: Create the two modules**

Create `backend/src/console/console.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { ConsoleGateway } from './console.gateway';
import { RconService } from './rcon.service';

@Module({
  imports: [AuthModule, ServersModule],
  providers: [ConsoleGateway, RconService],
})
export class ConsoleModule {}
```

Create `backend/src/metrics/metrics.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { MetricsGateway } from './metrics.gateway';
import { MetricsService } from './metrics.service';

@Module({
  imports: [AuthModule, ServersModule],
  providers: [MetricsGateway, MetricsService],
})
export class MetricsModule {}
```

- [ ] **Step 9: Run both gateway specs**

Run: `pnpm --filter ./backend exec jest console.gateway.spec metrics.gateway.spec`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/console backend/src/metrics/metrics.gateway.ts backend/src/metrics/metrics.module.ts
git commit -m "feat(backend): console + metrics socket.io gateways"
```

---

## Task 7: Wire modules, e2e, docs

**Files:**

- Modify: `backend/src/app.module.ts`
- Create: `backend/test/realtime.e2e-spec.ts`
- Modify: `backend/AGENTS.md`

**Interfaces:**

- Consumes: `ConsoleModule`, `MetricsModule`; socket.io-client; `SocketAuthService`/gateway message contracts from Task 6.
- Produces: `AppModule` importing both realtime modules; green e2e proving authed connect + one metrics tick + one console command over real sockets (DockerService + RconService faked).

- [ ] **Step 1: Import the modules into AppModule**

Edit `backend/src/app.module.ts` — add to `imports`:

```typescript
import { ConsoleModule } from './console/console.module';
import { MetricsModule } from './metrics/metrics.module';
// ...
  imports: [
    /* existing: ConfigModule, PrismaModule, AuthModule, UsersModule, ServersModule, VersionsModule */
    ConsoleModule,
    MetricsModule,
  ],
```

- [ ] **Step 2: Write the failing e2e test**

Create `backend/test/realtime.e2e-spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DockerService } from '../src/servers/docker.service';
import { RconService } from '../src/console/rcon.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { hashPassword } from '../src/auth/password.util';
import { Readable } from 'node:stream';

// A fake docker log stream that pushes one line then stays open.
function fakeLogStream(): Readable {
  const s = new Readable({ read() {} });
  setImmediate(() => s.push('Server started!\n'));
  return s;
}

const fakeDocker: Partial<DockerService> = {
  create: jest.fn().mockResolvedValue('fake-container-id'),
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  restart: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  inspect: jest.fn().mockResolvedValue({ running: true, status: 'running' }),
  logs: jest.fn().mockResolvedValue(fakeLogStream()),
  dataDir: jest.fn().mockReturnValue('/tmp/does-not-exist'),
};
const fakeRcon: Partial<RconService> = {
  send: jest
    .fn()
    .mockResolvedValue('There are 0 of a max of 20 players online'),
};
const fakeMetrics: Partial<MetricsService> = {
  collect: jest
    .fn()
    .mockResolvedValue({
      cpuPct: 5,
      memUsedMb: 300,
      memLimitMb: 2048,
      diskMb: 10,
    }),
};

describe('Realtime (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let url: string;
  let serverId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DockerService)
      .useValue(fakeDocker)
      .overrideProvider(RconService)
      .useValue(fakeRcon)
      .overrideProvider(MetricsService)
      .useValue(fakeMetrics)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    await app.listen(0); // ephemeral port for real socket.io
    const address = app.getHttpServer().address();
    url = `http://127.0.0.1:${typeof address === 'object' ? address!.port : address}`;

    prisma = app.get(PrismaService);
    await prisma.server.deleteMany({ where: { name: 'rt-e2e' } });
    await prisma.user.deleteMany({ where: { username: 'rt-e2e' } });
    await prisma.user.create({
      data: { username: 'rt-e2e', passwordHash: await hashPassword('pw123') },
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'rt-e2e', password: 'pw123' });
    cookie = (login.headers['set-cookie'] as unknown as string[])[0];

    const created = await request(app.getHttpServer())
      .post('/servers')
      .set('Cookie', cookie)
      .send({
        name: 'rt-e2e',
        loader: 'vanilla',
        version: '1.20.1',
        ramMb: 2048,
        port: 25597,
      });
    serverId = created.body.id;
  });

  afterAll(async () => {
    await prisma.server.deleteMany({ where: { name: 'rt-e2e' } });
    await prisma.user.deleteMany({ where: { username: 'rt-e2e' } });
    await app.close();
  });

  function connect(namespace: string): Socket {
    return io(`${url}${namespace}`, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
    });
  }

  it('rejects a socket with no auth cookie', (done) => {
    const socket = io(`${url}/metrics`, { transports: ['websocket'] });
    socket.on('disconnect', () => {
      socket.close();
      done();
    });
  });

  it('streams a metrics tick to an authed subscriber', (done) => {
    const socket = connect('/metrics');
    socket.on('connect', () => socket.emit('join', { serverId }));
    socket.on('stats', (payload: { serverId: string; cpuPct: number }) => {
      expect(payload.serverId).toBe(serverId);
      expect(payload.cpuPct).toBe(5);
      socket.close();
      done();
    });
  });

  it('streams a log line and returns command output on the console', (done) => {
    const socket = connect('/console');
    socket.on('connect', () => socket.emit('join', { serverId }));
    socket.on('log', (payload: { line: string }) => {
      expect(payload.line).toContain('Server started!');
      socket.emit('command', { serverId, command: 'list' });
    });
    socket.on('output', (payload: { output: string }) => {
      expect(payload.output).toContain('players online');
      socket.close();
      done();
    });
  });
});
```

- [ ] **Step 3: Run the e2e to verify it fails, then passes**

Run: `pnpm --filter ./backend exec jest --config test/jest-e2e.json realtime.e2e-spec`
Expected first: FAIL if modules not yet wired / contracts mismatched. After Step 1 wiring is in place and gateways implemented (Task 6), it should PASS. If it fails, fix the gateway/message contract — do not weaken the test.

- [ ] **Step 4: Update AGENTS.md**

Edit `backend/AGENTS.md`. Under the module list, add:

```markdown
- **console/** — `/console` socket.io gateway. Streams container logs to the
  browser (`log` events) and routes browser commands to the server over RCON
  (`command` → `output`). `RconService` pools one `rcon-client` connection per
  server; RCON is reached on `127.0.0.1:<ephemeral>` (published by DockerService,
  discovered via `rconEndpoint`). Never exposes `rconPassword`.
- **metrics/** — `/metrics` socket.io gateway. On `join`, polls Docker stats +
  data-dir size every 2s and emits `stats` (cpuPct / memUsedMb / memLimitMb /
  diskMb). `metrics.ts` holds the pure CPU%/mem math; `MetricsService.collect`
  adds disk usage.
```

Under environment/config, add:

```markdown
- `FRONTEND_ORIGIN` (optional, default `http://localhost:3000`) — CORS origin
  allowed to open the `/console` and `/metrics` WebSockets with credentials.
```

Under "how auth works", note:

```markdown
WebSocket connections authenticate at the socket.io handshake: `SocketAuthService`
parses the `mcp_token` cookie and verifies the JWT; unauthenticated sockets are
disconnected before any message is handled.
```

- [ ] **Step 5: Full gate — typecheck, lint, unit, e2e, fallow**

Run:

```bash
pnpm --filter ./backend run typecheck
pnpm --filter ./backend run lint
pnpm --filter ./backend test
pnpm --filter ./backend run test:e2e
pnpm --filter ./backend exec fallow || pnpm fallow
```

Expected: all green; fallow reports no dead code / duplicates. Fix anything red before committing.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app.module.ts backend/test/realtime.e2e-spec.ts backend/AGENTS.md
git commit -m "feat(backend): wire console+metrics modules, realtime e2e, docs"
```

---

## Self-Review Notes

- **Spec coverage:** Console module (logs→browser, commands→RCON) ✓ Tasks 5–6; Metrics module (CPU/RAM/disk + status via existing `getServer.live`) ✓ Tasks 1–2, 6; WS transport decision (socket.io) recorded ✓; RCON via `rcon-client` ✓; all realtime endpoints authed ✓ Task 3; RCON secret never sent ✓ (getRconTarget server-side only). Container-stats `disk` = data-dir bytes ✓.
- **Deferred (later phases / plans, per spec):** auto-reconnect is handled client-side by socket.io in Plan 4 (frontend); real-daemon integration test (create→command→log→stop) gated behind `MC_DOCKER_E2E=1` — noted as backlog, not built here; per-loader RCON metrics (TPS/players) is Phase 3.
- **Type consistency:** `RawStats` defined in Task 1, consumed in Task 2. `DockerService.dataDir(id)` defined Task 1, used in Task 6 metrics gateway. `getRconTarget` shape `{host,port,password}` consistent across Tasks 4/5. Message contracts (`join`/`log`/`command`/`output`/`stats`/`leave`) consistent across Tasks 6/7.
- **Security:** RCON loopback-only ephemeral bind; `rconPassword` confined to service layer; every socket JWT-verified at handshake; CORS credentialed to a single configurable origin.

## Backlog (not in this plan)

- Real-daemon realtime integration test (`MC_DOCKER_E2E=1`): create a throwaway itzg container, connect `/console`, send `list`, assert a real log line, stop+remove.
- RconService eviction on explicit stop/delete (currently self-heals on the next failed send/connect). Wire only if idle RCON sockets prove costly.
- Backpressure / rate-limit on log fan-out for very chatty servers.
- socket.io Redis adapter — only if the panel ever scales past one backend process (out of scope for single-host Phase 1).
