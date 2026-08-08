# mc-panel

A Minecraft server management panel. pnpm workspace monorepo with a Nest 11 +
Prisma backend (`backend/`) and a Next.js frontend (`frontend/`, not built
yet).

See **[AGENTS.md](./AGENTS.md)** for the full development guide (stack pins,
architecture rules, auth model, commands, git hooks). Backend-specific detail
is in **[backend/AGENTS.md](./backend/AGENTS.md)**.

## Quick start

```bash
pnpm install

# create an account (CLI-only — there is no signup route)
pnpm --filter ./backend run user -- create <username> <password>

# run the API
pnpm --filter ./backend start:dev
```
