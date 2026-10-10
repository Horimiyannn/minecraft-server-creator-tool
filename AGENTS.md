# AGENTS.md

Agent-onboarding guide for this repo. Read this before making changes.

## Project

Minecraft server management panel. This is a pnpm workspace monorepo:

- `backend/` — Nest 11 API (`mc-panel-backend`). See `backend/AGENTS.md` for backend-specific detail.
- `frontend/` — Next.js UI.
- `docs/superpowers/` — specs and plans (`docs/superpowers/specs/`, `docs/superpowers/plans/`).

## Stack — pinned versions, do not upgrade past these

- TypeScript **5.9**
- Prisma **6.19**
- Nest **11**
- CommonJS module output (not ESM)
- pnpm as the package manager (`packageManager` field pins `pnpm@10.28.1`)

**Do not upgrade to TypeScript 7 or Prisma 7.** This was proven in a spike on
2026-07-25:

- TypeScript 7 removed the programmatic compiler API that `nest-cli` depends
  on to build the project. It's slated to return in TS 7.1 (~October 2026),
  but until then a TS7 upgrade breaks `nest build` / `nest start` outright.
- Prisma 7 is ESM-only. This project is CommonJS end-to-end (Nest, Jest,
  ts-node); an ESM-only Prisma client breaks the toolchain.

If a task seems to call for either upgrade, don't do it — flag it instead.

## Commands (run from repo root)

```bash
pnpm install                              # install workspace deps
pnpm --filter ./backend start:dev         # run the API in watch mode
pnpm typecheck                            # tsc --noEmit (backend)
pnpm test                                 # backend unit tests (jest)
pnpm test:e2e                             # backend e2e tests (jest, test/*.e2e-spec.ts)
pnpm build                                # nest build
pnpm lint                                 # eslint .
pnpm format                               # prettier --write .
pnpm fallow                               # dead-code + duplicate-code gate
```

These are root-level delegating scripts (see root `package.json`); most of
them shell out to `backend` via `pnpm --filter ./backend run <script>`. For
backend-only scripts that have no root alias (e.g. the account CLI, Prisma
commands), invoke them directly against the backend package — see
`backend/AGENTS.md`.

## Architecture rule (binding)

**controller → service → repository.** Only repository classes import or use
`PrismaService`. Services never touch Prisma directly — they call into a
repository. Controllers never touch Prisma or the repository directly — they
call into a service. Do not shortcut this layering, even for "simple" reads.

## Auth model

- Username + password. **No email, no HTTP signup route.**
- Accounts are created, reset, deleted, and listed **only** via the CLI:
  `pnpm --filter ./backend run user -- create <username> <password>`
  `pnpm --filter ./backend run user -- reset <username> <newPassword>`
  `pnpm --filter ./backend run user -- delete <username>`
  `pnpm --filter ./backend run user -- list`
- On login, the API issues a JWT in an httpOnly cookie named **`mcp_token`**.
  There is no bearer-token flow for browser clients.

## Environment

Required vars: `DATABASE_URL`, `JWT_SECRET`. These are validated by
`verifyEnv()` at process boot (`backend/src/config/env.ts`) and can be checked
standalone with:

```bash
pnpm --filter ./backend run verify:env
```

Never commit `.env`.

## Git hooks

- **pre-commit**: `lint-staged` (eslint --fix + prettier --write on staged
  files) followed by `pnpm typecheck`.
- **pre-push**: `pnpm build && pnpm test && pnpm test:e2e && pnpm fallow`.

Do not bypass these with `--no-verify`. If a hook fails, fix the underlying
code — don't skip the gate.

## Commits

Never add `Co-Authored-By:` trailers (or any other AI attribution such as
`Claude-Session:` lines) to commit messages.

## fallow

`fallow` (dead-code + duplicate-code analysis) is configured at repo root via
`.fallowrc.json` and run via `pnpm fallow` (pre-push gate). It also ships an
MCP server binary, `fallow-mcp`, for live analysis from an agent — see
"fallow MCP" in `backend/AGENTS.md` for how to register it.

## Frontend

`frontend/` — Next 16 App Router, layered module architecture mirroring the
org's `sense-frontend` (`src/ui` primitives · `src/components` shared ·
`src/modules/<feature>` with an `index.ts` public surface · shared
`src/{lib,utils,types,constants,hooks}`). Tailwind v4, TanStack Query for
HTTP, socket.io-client for live console/metrics. Talks to the API
cross-origin with `credentials:'include'` (backend `enableCors`).

- `pnpm --filter ./frontend dev` — UI on :3000 (API must be on :3001).
- `pnpm --filter ./frontend test` — Jest (next/jest) unit/component tests.
- `pnpm --filter ./frontend e2e` — Playwright, route-mocked backend (manual/CI,
  not in pre-push).
- Env: `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`). Backend needs
  `FRONTEND_ORIGIN` (default `http://localhost:3000`).
- `src/modules/backups` — the server Backups tab: list by kind with trigger
  badges, create world/full snapshots, download, delete, restore (behind a
  confirm dialog), and the interval/retention/chat schedule form over
  `/servers/:id/backups`.
- `src/modules/files` — the server Files tab: browse, edit (mtime conflict
  → 409 warning), upload/download, bulk delete, search, zip extract/compress
  over `/servers/:id/files`.
- Boundaries: `frontend/.fallowrc.json` zones + ESLint `no-restricted-imports`.
  A module's `ui/` is private — never import `@/modules/*/ui` from outside it.
