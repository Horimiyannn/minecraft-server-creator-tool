# Minecraft Server Panel — Phase 1 (MVP) Design

**Date**: 2026-07-25
**Status**: Approved for planning

## Purpose

A self-hosted web panel to deploy and operate Minecraft servers on a single
Ubuntu host. Phase 1 delivers the core loop: log in, create a server, run it,
and interact with its console live. File management, backups, richer in-game
metrics, and additional loaders come in later phases.

## Scope

### In scope (Phase 1)

- **Auth**: login for a small fixed set of near-admin users (3–4). Username +
  password (no email). JWT in an httpOnly cookie. No RBAC, no self-service
  signup. Accounts created only via a server-side CLI script (create / reset
  password / delete) run by an admin on the host.
- **Create server** via wizard for loaders: **Vanilla, Paper, Forge, NeoForge**.
  Select loader + version (versions fetched live) + RAM + port.
- **Lifecycle**: start / stop / restart per server.
- **Live console**: stream container logs to the browser; send commands back.
- **Basic monitoring**: per-server status + Docker container stats
  (CPU / RAM / disk) + live log stream.

### Out of scope (later phases)

- File manager (Phase 2)
- Backups (Phase 2)
- Fabric / Quilt, player-count / TPS dashboard, import-existing (Phase 3)
- Fine-grained roles/permissions (not planned)

## Architecture

Single Ubuntu host. All components co-located.

```
Ubuntu host
  nginx (TLS reverse proxy)
    /            -> Next.js frontend
    /api, /ws    -> Nest.js backend
  Nest.js backend
    - dockerode      -> Docker Engine -> mc-server-N (itzg image)
    - rcon-client    -> containers (commands, later metrics)
    - SQLite         -> users, servers
    - host FS        -> /srv/mc/<id>/data (bind-mount)
```

- **Runtime engine**: each MC server is one `itzg/minecraft-server` container.
  itzg handles loader+version download/install (Vanilla/Paper/Forge/NeoForge)
  via env vars, exposes RCON, and provides a healthcheck. The panel orchestrates
  containers; it does not implement per-loader install logic itself.
- **Persistence**: SQLite for v1 (single box, zero setup). Schema kept
  migration-friendly so Postgres is a later swap if needed.
- **Data location**: each server's data dir bind-mounted at `/srv/mc/<id>/data`
  on the host, so future file-manager and backup phases operate on plain files.

## Backend modules (Nest.js)

Each module has one job and is testable in isolation.

| Module           | Responsibility                                                                                                                  | Key deps               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Auth**         | Login, JWT issue/verify, user table (username + bcrypt hash). CLI script for account create/reset/delete. No HTTP signup route. | jwt, bcrypt            |
| **Servers**      | CRUD server records; lifecycle start/stop/restart; status.                                                                      | dockerode              |
| **Provisioning** | Map wizard input (loader/version/RAM/port) → itzg env → create container.                                                       | dockerode              |
| **Console**      | WebSocket gateway. Container logs → browser; browser commands → RCON.                                                           | rcon-client, dockerode |
| **Metrics**      | Docker stats (CPU/RAM/disk) + status; push over WS.                                                                             | dockerode              |
| **Versions**     | Fetch available versions per loader from upstream manifests.                                                                    | http                   |

Shared utilities:

- **DockerService** — single wrapper for all container operations (create,
  start, stop, restart, inspect, stats, logs, attach). Everything Docker goes
  through it; nothing else imports `dockerode` directly.
- **RconService** — connection pool/helper for sending commands and reading
  responses per server.

## Frontend (Next.js, App Router)

| Screen            | Contents                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Login**         | Username + password → JWT httpOnly cookie. No registration link.                                                               |
| **Dashboard**     | Server cards: name, loader/version badge, status dot, live CPU/RAM. Start/stop/restart buttons. "New server" button.           |
| **Create wizard** | name → loader → version (live dropdown) → RAM/port → advanced env.                                                             |
| **Server detail** | Tabs: **Console** (xterm.js + WS + command input), **Metrics** (CPU/RAM/disk, status), **Settings** (RAM, env, delete server). |

- Live data (console, stats) over one WebSocket per open server.
- Version dropdowns fetched from the backend **Versions** module (Mojang / Paper
  / Forge / NeoForge manifests) — no hardcoded version lists.

## Data flow — live console

```
browser xterm --cmd--> WS --> Nest Console gateway --> RCON --> container
container stdout --> Nest tails logs --> WS --> browser xterm
```

- Commands sent via RCON for reliable request/response.
- Log output tailed from the container stdout stream and pushed to the browser.

## Provisioning flow

1. Wizard POSTs `{ name, loader, version, ramMb, port, env }`.
2. Provisioning maps to itzg env (e.g. `TYPE`, `VERSION`, `MEMORY`, `EULA=TRUE`,
   `RCON_PASSWORD` random-generated) and a bind-mount at `/srv/mc/<id>/data`.
3. DockerService creates + starts the container.
4. Failures surface in the wizard with container logs; server record marked
   `failed` until resolved.

## Error handling

- Container create/start failures return structured errors + recent container
  logs to the wizard.
- Health/status derived from Docker inspect + healthcheck; unhealthy shown on
  the card.
- WebSocket drops auto-reconnect from the frontend; backend re-attaches log
  stream.

## Security

- JWT in httpOnly cookie; bcrypt password hashes; all routes require auth.
- **Docker socket is root-equivalent.** Backend runs as a dedicated non-root
  user in the `docker` group. All container inputs (names, env keys/values,
  ports) validated and sanitized before reaching DockerService.
- RCON password per server, randomly generated, stored server-side, never sent
  to the frontend.
- nginx terminates TLS. Backend not exposed directly.
- Path handling: even though the file manager is Phase 2, the data-dir layout
  (`/srv/mc/<id>/data`) is fixed now so a future **PathGuard** can jail all file
  ops without a redesign.

## Testing

- **Unit**: wizard-input → itzg-env mapping; version-manifest parsing; auth
  token issue/verify; CLI account-create writes a valid bcrypt user; DockerService
  called with correct args (dockerode mocked).
- **Integration**: real throwaway itzg container in CI — create → start → send a
  console command via RCON → read log line → stop → remove.
- **E2E**: happy path — log in, create a Vanilla server, start it, see console
  output, stop it.

## Resolved stack decisions (from spike, 2026-07-25)

- **Package manager**: pnpm (with `pnpm.onlyBuiltDependencies` allowlisting Prisma's postinstall).
- **ORM**: Prisma 6 + SQLite, CommonJS. DB access isolated behind repository classes
  (controller → service → repository); only repositories touch `PrismaService`.
- **TypeScript 5.9 / Nest 11 / CommonJS.** TypeScript 7 and Prisma 7 were rejected for
  v1: TS7 removed the programmatic compiler API that nest-cli needs (returns in 7.1,
  ~Oct 2026), and Prisma 7's ESM-only client forces ESM friction. Revisit after TS 7.1.
- **Env safety**: a shared `verifyEnv()` validates required vars at boot and via a
  standalone `verify:env` script; the app refuses to start if any are missing.

## Open decisions deferred to later plans

- WebSocket transport (socket.io vs native ws via Nest gateway) — decided in the
  Console/Metrics plan.
- itzg env mapping table per loader — worked out in the Provisioning plan.

```

```
