# backend/AGENTS.md

Backend-specific detail for agents. Read the root `AGENTS.md` first for
repo-wide rules (stack pins, architecture rule, auth model, git hooks) — this
file only adds backend detail on top of that.

## Module layout (`backend/src/`)

- `auth/` — login endpoint, `JwtAuthGuard`, `CurrentUser` decorator,
  `password.util` (hash/verify), DTOs in `auth/dto/`.
- `users/` — `UsersService` (business logic) + `UserRepository` (Prisma
  access) for the account CLI and auth to share.
- `prisma/` — `PrismaModule` / `PrismaService` (the Nest wrapper around the
  Prisma client). **This is the only place `PrismaService` may be injected.**
- `health/` — health-check endpoint.
- `config/` — `env.ts` (`verifyEnv()` and required env var list).
- `main.ts` — app bootstrap (`ValidationPipe`, cookie parsing, etc.).

The Prisma **schema and migrations** live separately, at `backend/prisma/`
(`backend/prisma/schema.prisma`, `backend/prisma/migrations/`) — not under
`src/`.

## Repository pattern

Every table gets a repository class in the owning feature folder (e.g.
`backend/src/users/user.repository.ts`) that is the sole consumer of
`PrismaService` for that table. It exposes plain, intention-revealing methods
(`findByUsername`, `create`, `updatePasswordHash`, `delete`, `list`, ...) and
translates Prisma error codes into Nest HTTP exceptions at the boundary (e.g.
`P2002` → `ConflictException`, `P2025` → `NotFoundException`). The
corresponding service (e.g. `UsersService`) depends only on the repository,
never on `PrismaService` or `@prisma/client` types directly.

## Account CLI

`backend/scripts/user.ts` (a Commander program run via `ts-node`, invoked
through `nest`'s `createApplicationContext` so it reuses `UsersService`):

```bash
pnpm --filter ./backend run user -- create <username> <password>
pnpm --filter ./backend run user -- reset <username> <newPassword>
pnpm --filter ./backend run user -- delete <username>
pnpm --filter ./backend run user -- list
```

This is the **only** way to create an account — there is no HTTP signup
route.

## Adding a Prisma model / migrating

1. Edit `backend/prisma/schema.prisma`.
2. Run, from repo root:
   ```bash
   pnpm --filter ./backend exec prisma migrate dev --name <name>
   ```
3. Regenerate the client if needed: `pnpm --filter ./backend run prisma:generate`
   (migrate dev does this automatically in dev).
4. Add a repository for the new table under the owning feature folder — do
   not let services or controllers call `PrismaService` directly.

## Tests

- Unit tests: `*.spec.ts`, colocated next to the code under `backend/src/`
  (e.g. `backend/src/users/user.repository.spec.ts`). Run with `pnpm test`
  (root) / `pnpm --filter ./backend test`. Config: `backend/jest.config.js`,
  `rootDir: 'src'`, `maxWorkers: 3`.
- E2E tests: `*.e2e-spec.ts` under `backend/test/`. Run with `pnpm test:e2e`
  (root) / `pnpm --filter ./backend test:e2e`. Config:
  `backend/test/jest-e2e.json`, also `maxWorkers: 3`.

## Environment

Required: `DATABASE_URL`, `JWT_SECRET` (see `backend/src/config/env.ts`).
Verify with `pnpm --filter ./backend run verify:env`
(`backend/scripts/verify-env.ts`). Same rule as root: never commit `.env`.

## fallow MCP

`fallow` ships an MCP server binary, `fallow-mcp`
(`node_modules/.bin/fallow-mcp` once installed), so an agent can query
dead-code / duplicate-code analysis live instead of only via the `pnpm fallow`
pre-push gate. It communicates over stdio.

Per `https://docs.fallow.tools/integrations/mcp` (fetched 2026-07-25), the
registration is client-config only — no extra install beyond the existing
`fallow` devDependency. Because `fallow-mcp` is a local devDependency here
(not a global install), register it through the package manager so binary
resolution works, e.g. for Claude Code (`.claude/settings.json`, not present
in this repo yet — add it if you want this wired up):

```json
{
  "mcpServers": {
    "fallow": {
      "command": "pnpm",
      "args": ["exec", "fallow-mcp"]
    }
  }
}
```

Notes from the doc:

- Transport is stdio; no auth/flags needed for basic use.
- Launch from the project root so `pnpm exec` resolves the local binary.
- An optional `FALLOW_BIN` env var can point at a specific `fallow` binary if
  you need to override which one the MCP server shells out to.
- If registering globally instead of per-project, the plain form
  `{"command": "fallow-mcp"}` works once `fallow-mcp` is on `PATH`.

Verified locally: `pnpm exec fallow-mcp --help` resolves and runs the binary
from `node_modules/.bin/fallow-mcp` (it reports a stdio handshake message,
confirming it's an MCP stdio server, not a general-purpose CLI).

**TODO**: no `.claude/settings.json` exists in this repo yet — if you want
`fallow-mcp` actually wired into this project's Claude Code session, create
that file with the block above rather than assuming it's already active.
