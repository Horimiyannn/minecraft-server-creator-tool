# Frontend Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase-1 Next.js frontend — login, dashboard with live server cards, create wizard, and per-server detail (live console, live metrics, settings) — against the existing Nest backend.

**Architecture:** New `frontend` package in the pnpm workspace. Next 16 App Router (all client components — everything is behind a cookie + WebSockets, so there is no SSR data fetch). Layered, module-oriented architecture mirroring the org's `sense-frontend` (see "Conventions" below): `src/ui` (dumb primitives), `src/components` (shared business components), `src/modules/<name>` (self-contained features, public surface via `index.ts`), `src/{lib,utils,types,constants,hooks}` (shared). HTTP goes through TanStack Query over a `credentials:'include'` fetch client; live console/metrics go over `socket.io-client` with `withCredentials:true`. The browser talks to the backend cross-origin, so the backend gains a one-line `enableCors`.

**Tech Stack:** Next 16.3.4 (App Router, React 19), Tailwind v4, `@tanstack/react-query` v5, `socket.io-client` v4, `@xterm/xterm` v5, Jest (via `next/jest`) + Testing Library + jsdom, Playwright, ESLint flat config (`eslint-config-next`), fallow boundary zones.

**Spec:** `docs/superpowers/specs/2026-07-25-mc-panel-phase1-design.md` (Frontend section)
**Reference architecture:** `/ssd/work/sense/sense-frontend` — `ARCHITECTURE.md`, `CLAUDE.md`, `.fallowrc.json`, `eslint.config.js`, `jest.config.mjs`.

## Global Constraints

- pnpm workspace, `packageManager` pins `pnpm@10.28.1`. Run frontend scripts as `pnpm --filter ./frontend <script>`. Add `frontend` to `pnpm-workspace.yaml`.
- TypeScript **5.9** (match the repo pin; do not exceed). Do not touch backend TS7/Prisma7 constraints.
- Next **16.3.4**, React **19**, Tailwind **v4**, `@tanstack/react-query` **v5**, `socket.io-client` **v4** (must match backend `socket.io` v4), `@xterm/xterm` **v5**. Test runner: **Jest via `next/jest`** (matches backend + sense-frontend — NOT Vitest). Playwright for e2e.
- **Layered module architecture (mirrors `sense-frontend/ARCHITECTURE.md`):**
  - `src/ui/` — pure presentational primitives, zero domain logic, has an `index.ts` barrel.
  - `src/components/` — shared business components used by >1 module, has an `index.ts` barrel.
  - `src/modules/<name>/` — self-contained feature; internal dirs as needed from `{ api, hooks, components, ui, types, constants }`; **`index.ts` is the module's public surface** (named re-exports). A module's own `ui/` is **private** — never imported from outside that module.
  - `src/{lib, utils, types, constants, hooks}/` — cross-cutting shared code.
  - `src/app/` — Next App Router routes/layouts only; composes module + component pieces.
- **Import aliases:** `@/*` → `src/*`; `@ui`/`@ui/*` and `@components`/`@components/*` barrel shortcuts. Prefer a module's `index.ts` barrel over deep internals; deep imports are acceptable when the barrel doesn't export what's needed.
- **Enforced boundaries** (both gates, keep at 0 violations):
  - `frontend/.fallowrc.json` boundary zones — layer graph (see Task 9).
  - ESLint `no-restricted-imports` blocks `@/modules/*/ui/*` from outside the module.
- **Auth:** JWT lives in httpOnly cookie `mcp_token`. All fetches use `credentials:'include'`; a `401` redirects to `/login`. Do NOT change the backend cookie/JWT model.
- **Cross-origin:** browser → backend directly. Backend adds `app.enableCors({ origin: FRONTEND_ORIGIN, credentials: true })`. FE origin `http://localhost:3000`, API `http://localhost:3001`.
- **RCON password never reaches the frontend** (enforced server-side already). The FE never requests, displays, or sends it.
- No shadcn / Radix, no global state store (TanStack Query for server state + local `useState`; add a Zustand store only if a module later needs cross-component client state), no SSR data fetching, no theme switcher.
- **Comments:** default to none; add one only for a non-obvious "why" or a `ponytail:`-marked corner. No comments that restate the next line.
- **Commits: title-only, no body, no `Co-Authored-By` / `Claude-Session` / "Generated with" / any Claude/agent/AI attribution** (per `backend/AGENTS.md` › Commits). Form: `<type>: <short imperative>` ≤100 chars. (This repo DOES commit plan/spec docs — that is repo precedent; commit this plan.)
- Never bypass git hooks with `--no-verify`.

## Backend HTTP contract (fixed — do not change the backend beyond CORS)

- `POST /auth/login` `{username,password}` → sets cookie, returns `{ id, username }`.
- `POST /auth/logout` → clears cookie.
- `GET /auth/me` → `{ id, username }` (401 if unauthenticated).
- `GET /servers` → `PublicServer[]`.
- `POST /servers` `{name,loader,version,ramMb,port}` → `PublicServer`.
- `GET /servers/:id` → `PublicServer & { live: { running, status } | null }`.
- `POST /servers/:id/start|stop|restart` → `PublicServer`.
- `DELETE /servers/:id` → 200.
- `GET /versions/:loader` → `string[]` (version ids).
- WS `/console`: client emits `join {serverId}` / `command {serverId,command}` / `leave {serverId}`; server emits `log {serverId,line}`, `output {serverId,output}`, `error {serverId,message}`.
- WS `/metrics`: client emits `join {serverId}` / `leave {serverId}`; server emits `stats {serverId,cpuPct,memUsedMb,memLimitMb,diskMb}`.

`PublicServer` = `{ id, name, loader, version, ramMb, port, containerId, status, createdAt }` (no `rconPassword`). `status` ∈ `creating|running|stopped|failed`. `loader` ∈ `vanilla|paper|forge|neoforge`.

> **Task 1 Step 1 verifies these shapes against the real backend** (`backend/src/metrics/metrics.ts` `ServerStats`, `backend/src/servers/server.repository.ts` `ServerRecord`). Correct the `types/` files if they differ.

---

### Task 1: Scaffold `frontend` workspace + tooling + backend CORS

**Files:**

- Create: `frontend/package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `jest.config.mjs`, `jest.setup.ts`, `.env.local.example`, `.gitignore`
- Create: `frontend/src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (temporary; removed in Task 4)
- Create: `frontend/src/utils/cn.ts`, `src/utils/index.ts`, `src/utils/cn.test.ts`
- Modify: `pnpm-workspace.yaml` (add `- frontend`)
- Modify: `backend/src/main.ts` (add `enableCors`); Create: `backend/test/cors.e2e-spec.ts`
- Modify: `README.md` (frontend quick-start line)

**Interfaces:**

- Produces: bootable Next app on `:3000`; scripts `dev/build/start/lint/typecheck/test/e2e`; `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`); `cn(...classes)` helper; backend CORS for `FRONTEND_ORIGIN`.

- [ ] **Step 1: Verify backend payload shapes**

Read `backend/src/metrics/metrics.ts` (`ServerStats`) and `backend/src/servers/server.repository.ts` (`ServerRecord`). Confirm the `stats` keys and `PublicServer` fields match the contract above; note differences for Task 2's `types/`.

- [ ] **Step 2: `frontend/package.json`**

```json
{
  "name": "frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "test:watch": "jest --watch",
    "e2e": "playwright test",
    "e2e:install": "playwright install --with-deps chromium"
  },
  "dependencies": {
    "next": "16.3.4",
    "react": "^19.1.2",
    "react-dom": "^19.1.2",
    "@tanstack/react-query": "^5.90.0",
    "socket.io-client": "^4.8.1",
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "@types/node": "^22.16.0",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@types/jest": "^29.5.14",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^29.7.0",
    "@testing-library/react": "^16.3.0",
    "@testing-library/jest-dom": "^6.9.0",
    "@testing-library/user-event": "^14.5.2",
    "eslint": "^9.30.0",
    "eslint-config-next": "16.3.4",
    "eslint-config-prettier": "^9.1.0",
    "@playwright/test": "^1.49.0"
  }
}
```

> Run `pnpm install` from the repo root; let pnpm resolve latest patch of each `^` range. Keep `next` and `eslint-config-next` on **16.3.4** (matches sense-frontend). `socket.io-client` MUST stay major 4.

- [ ] **Step 3: TS + Next + PostCSS config**

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@ui": ["./src/ui"],
      "@ui/*": ["./src/ui/*"],
      "@components": ["./src/components"],
      "@components/*": ["./src/components/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "jest.setup.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules", "e2e"]
}
```

`frontend/next.config.ts`:

```ts
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {};
export default nextConfig;
```

`frontend/postcss.config.mjs`:

```js
const config = { plugins: { '@tailwindcss/postcss': {} } };
export default config;
```

`frontend/src/app/globals.css`:

```css
@import 'tailwindcss';

:root {
  color-scheme: dark;
}
body {
  @apply bg-neutral-950 text-neutral-100;
}
```

`frontend/.env.local.example`:

```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

`frontend/.gitignore`:

```
/.next/
/node_modules/
/coverage/
/test-results/
/playwright-report/
.env.local
next-env.d.ts
tsconfig.tsbuildinfo
```

- [ ] **Step 4: ESLint flat config (mirrors sense-frontend)**

`frontend/eslint.config.mjs`:

```js
import next from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';

const eslintConfig = [
  ...next,
  prettier,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'prefer-const': 'error',
      // A module's `ui/` is private to that module.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/ui', '@/modules/*/ui/*'],
              message:
                "Don't import another module's `ui/` internals — go through the module index, or lift it to @ui/@components.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
```

- [ ] **Step 5: Jest config + setup (via `next/jest`)**

`frontend/jest.config.mjs`:

```js
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@ui$': '<rootDir>/src/ui',
    '^@ui/(.*)$': '<rootDir>/src/ui/$1',
    '^@components$': '<rootDir>/src/components',
    '^@components/(.*)$': '<rootDir>/src/components/$1',
  },
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
    '<rootDir>/e2e/',
  ],
};

export default createJestConfig(customJestConfig);
```

`frontend/jest.setup.ts`:

```ts
import '@testing-library/jest-dom';

// jsdom lacks a few DOM APIs our components/tests touch.
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
```

- [ ] **Step 6: `cn` util (+ test)**

`frontend/src/utils/cn.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

`frontend/src/utils/index.ts`:

```ts
export { cn } from './cn';
```

`frontend/src/utils/cn.test.ts`:

```ts
import { cn } from './cn';

describe('cn', () => {
  it('joins truthy classes', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
```

- [ ] **Step 7: Root layout + placeholder page**

`frontend/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'mc-panel' };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`frontend/src/app/page.tsx`:

```tsx
export default function Home() {
  return <main className="p-8">mc-panel</main>;
}
```

- [ ] **Step 8: Add to workspace, install, verify**

Edit `pnpm-workspace.yaml`:

```yaml
packages:
  - backend
  - frontend
```

Run: `pnpm install`
Run: `pnpm --filter ./frontend test` → 1 test file (cn) passes.
Run: `pnpm --filter ./frontend typecheck` → clean.
Run: `pnpm --filter ./frontend build` → succeeds.
Run: `pnpm --filter ./frontend lint` → clean.

- [ ] **Step 9: Backend CORS + e2e**

Edit `backend/src/main.ts` — right after `const app = await NestFactory.create(AppModule);`:

```ts
const app = await NestFactory.create(AppModule);
app.enableCors({
  origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
});
app.use(cookieParser());
```

`backend/test/cors.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('CORS (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableCors({ origin: 'http://localhost:3000', credentials: true });
    await app.init();
  });
  afterAll(async () => app.close());

  it('reflects the allowed origin with credentials', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
```

Run: `pnpm --filter ./backend test:e2e -- cors` → passes.

- [ ] **Step 10: README + commit**

Add under README Quick start:

```md
# run the frontend (separate terminal, needs the API on :3001)

pnpm --filter ./frontend dev
```

```bash
git add frontend pnpm-workspace.yaml backend/src/main.ts backend/test/cors.e2e-spec.ts README.md docs/superpowers/plans/2026-09-05-frontend-panel.md
git commit -m "scaffold frontend workspace, tooling, and backend CORS"
```

---

### Task 2: Core lib — api-client, query provider, socket factory, global types/constants

**Files:**

- Create: `frontend/src/constants/index.ts`
- Create: `frontend/src/types/api.ts`, `src/types/index.ts`
- Create: `frontend/src/lib/api-client.ts`, `src/lib/api-client.test.ts`
- Create: `frontend/src/lib/query-client.ts`, `src/lib/socket.ts`
- Create: `frontend/src/components/Providers.tsx`, `src/components/index.ts`
- Modify: `frontend/src/app/layout.tsx` (wrap children in `Providers`)

**Interfaces:**

- Produces:
  - `api<T>(path, init?): Promise<T>` — `credentials:'include'`; throws `ApiError` (`{ name:'ApiError', status }`) on non-2xx; `undefined` on 204.
  - `class ApiError extends Error { status: number }`.
  - Constants: `API_URL`, `ROUTES`, `QUERY_KEYS`, `SOCKET_EVENTS`, `LOADERS`.
  - `queryClient`; `makeSocket(namespace): Socket` (`withCredentials`, websocket, `forceNew`).
  - Types: `Loader`, `ServerStatus`, `PublicServer`, `ServerDetail`, `Session`, `ServerStats`, `ConsoleLog`, `ConsoleOutput`.
  - `<Providers>` (in `@/components` barrel).

- [ ] **Step 1: Constants**

`frontend/src/constants/index.ts`:

```ts
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const ROUTES = {
  login: '/login',
  dashboard: '/',
  newServer: '/servers/new',
  server: (id: string) => `/servers/${id}`,
} as const;

export const QUERY_KEYS = {
  me: ['me'] as const,
  servers: ['servers'] as const,
  server: (id: string) => ['servers', id] as const,
  versions: (loader: string) => ['versions', loader] as const,
};

export const SOCKET_EVENTS = {
  join: 'join',
  leave: 'leave',
  command: 'command',
  log: 'log',
  output: 'output',
  error: 'error',
  stats: 'stats',
} as const;

export const LOADERS = ['vanilla', 'paper', 'forge', 'neoforge'] as const;
```

- [ ] **Step 2: Global types**

`frontend/src/types/api.ts`:

```ts
import type { LOADERS } from '@/constants';

export type Loader = (typeof LOADERS)[number];
export type ServerStatus = 'creating' | 'running' | 'stopped' | 'failed';

export interface PublicServer {
  id: string;
  name: string;
  loader: Loader;
  version: string;
  ramMb: number;
  port: number;
  containerId: string | null;
  status: ServerStatus;
  createdAt: string;
}

export interface ServerDetail extends PublicServer {
  live: { running: boolean; status: string } | null;
}

export interface Session {
  id: string;
  username: string;
}

export interface ServerStats {
  serverId: string;
  cpuPct: number;
  memUsedMb: number;
  memLimitMb: number;
  diskMb: number;
}

export interface ConsoleLog {
  serverId: string;
  line: string;
}
export interface ConsoleOutput {
  serverId: string;
  output: string;
}
```

`frontend/src/types/index.ts`:

```ts
export * from './api';
```

> Adjust `ServerStats` keys to whatever Task 1 Step 1 found.

- [ ] **Step 3: Failing api-client test**

`frontend/src/lib/api-client.test.ts`:

```ts
import { api, ApiError } from './api-client';

function fakeResponse(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => body,
  } as Response;
}

describe('api', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends credentials and returns parsed json', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        fakeResponse(200, JSON.stringify({ ok: true })),
      ) as jest.Mock;
    const result = await api<{ ok: boolean }>('/health');
    expect(result).toEqual({ ok: true });
    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(init.credentials).toBe('include');
  });

  it('throws ApiError with status on non-2xx', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse(401, 'nope')) as jest.Mock;
    await expect(api('/auth/me')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/auth/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });
  });

  it('returns undefined for 204 no-content', async () => {
    global.fetch = jest.fn().mockResolvedValue(fakeResponse(204)) as jest.Mock;
    await expect(
      api('/servers/x', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run — expect FAIL** (`Cannot find module './api-client'`).

Run: `pnpm --filter ./frontend test -- api-client`

- [ ] **Step 5: Implement api-client**

`frontend/src/lib/api-client.ts`:

```ts
import { API_URL } from '@/constants';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
```

- [ ] **Step 6: Run — expect PASS.**

- [ ] **Step 7: Query client, socket factory, Providers**

`frontend/src/lib/query-client.ts`:

```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});
```

`frontend/src/lib/socket.ts`:

```ts
import { io, type Socket } from 'socket.io-client';
import { API_URL } from '@/constants';

export function makeSocket(namespace: '/console' | '/metrics'): Socket {
  return io(`${API_URL}${namespace}`, {
    withCredentials: true,
    transports: ['websocket'],
    forceNew: true,
  });
}
```

`frontend/src/components/Providers.tsx`:

```tsx
'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

`frontend/src/components/index.ts`:

```ts
export { Providers } from './Providers';
```

Edit `frontend/src/app/layout.tsx` — wrap children:

```tsx
import { Providers } from '@components';
// ...
<body>
  <Providers>{children}</Providers>
</body>;
```

- [ ] **Step 8: Verify + commit**

Run: `pnpm --filter ./frontend test && pnpm --filter ./frontend typecheck && pnpm --filter ./frontend lint`.

```bash
git add frontend/src
git commit -m "feat: add frontend api client, query provider, socket factory, core types"
```

---

### Task 3: Global UI primitives

**Files:**

- Create: `frontend/src/ui/Button.tsx`, `Input.tsx`, `Select.tsx`, `Badge.tsx`, `Card.tsx`, `Spinner.tsx`, `Tabs.tsx`, `index.ts`
- Create: `frontend/src/ui/Button.test.tsx`, `Tabs.test.tsx`

**Interfaces:**

- Produces (Tailwind + `cn`, no external UI lib, NEVER imports from `modules/` or `components/`):
  - `<Button variant?="primary"|"ghost"|"danger" loading?={boolean} {...}/>`
  - `<Input label?={string} error?={string} {...}/>`
  - `<Select label?={string} options={{value,label}[]} {...}/>`
  - `<Badge tone="green"|"gray"|"red"|"yellow">…</Badge>`
  - `<Card className?>…</Card>`, `<Spinner/>`
  - `<Tabs<K> tabs current onChange/>` (controlled).
  - `@ui` barrel exports all.

- [ ] **Step 1: Failing tests**

`frontend/src/ui/Button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('fires onClick', async () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled while loading', () => {
    render(<Button loading>Go</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

`frontend/src/ui/Tabs.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs';

describe('Tabs', () => {
  it('calls onChange with the tab key', async () => {
    const onChange = jest.fn();
    render(
      <Tabs
        tabs={[
          { key: 'a', label: 'A' },
          { key: 'b', label: 'B' },
        ]}
        current="a"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement primitives**

`frontend/src/ui/Spinner.tsx`:

```tsx
export function Spinner() {
  return (
    <span
      role="status"
      aria-label="loading"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
```

`frontend/src/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/utils';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'ghost' | 'danger';
const styles: Record<Variant, string> = {
  primary: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  ghost: 'bg-neutral-800 hover:bg-neutral-700 text-neutral-100',
  danger: 'bg-red-700 hover:bg-red-600 text-white',
};

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed',
        styles[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
```

`frontend/src/ui/Input.tsx`:

```tsx
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/utils';

export function Input({
  label,
  error,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label && <span className="text-neutral-300">{label}</span>}
      <input
        {...rest}
        className={cn(
          'rounded-md bg-neutral-900 border border-neutral-700 px-3 py-1.5 outline-none focus:border-emerald-500',
          className,
        )}
      />
      {error && <span className="text-red-400 text-xs">{error}</span>}
    </label>
  );
}
```

`frontend/src/ui/Select.tsx`:

```tsx
import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/utils';

export function Select({
  label,
  options,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label && <span className="text-neutral-300">{label}</span>}
      <select
        {...rest}
        className={cn(
          'rounded-md bg-neutral-900 border border-neutral-700 px-3 py-1.5 outline-none focus:border-emerald-500',
          className,
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

`frontend/src/ui/Badge.tsx`:

```tsx
type Tone = 'green' | 'gray' | 'red' | 'yellow';
const tones: Record<Tone, string> = {
  green: 'bg-emerald-900 text-emerald-300',
  gray: 'bg-neutral-800 text-neutral-300',
  red: 'bg-red-900 text-red-300',
  yellow: 'bg-yellow-900 text-yellow-300',
};
export function Badge({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
```

`frontend/src/ui/Card.tsx`:

```tsx
import { cn } from '@/utils';

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-neutral-800 bg-neutral-900 p-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
```

`frontend/src/ui/Tabs.tsx`:

```tsx
export function Tabs<K extends string>({
  tabs,
  current,
  onChange,
}: {
  tabs: { key: K; label: string }[];
  current: K;
  onChange: (key: K) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-neutral-800">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === current}
          onClick={() => onChange(t.key)}
          className={
            t.key === current
              ? 'px-3 py-2 text-sm border-b-2 border-emerald-500 text-white'
              : 'px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200'
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

`frontend/src/ui/index.ts`:

```ts
export { Button } from './Button';
export { Input } from './Input';
export { Select } from './Select';
export { Badge } from './Badge';
export { Card } from './Card';
export { Spinner } from './Spinner';
export { Tabs } from './Tabs';
```

- [ ] **Step 4: Run — expect PASS + typecheck + lint.**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui
git commit -m "feat: add global ui primitives"
```

---

### Task 4: Auth module + login page + panel layout guard

**Files:**

- Create: `frontend/src/modules/auth/api.ts`, `hooks.ts`, `index.ts`
- Create: `frontend/src/modules/auth/components/LoginForm.tsx`, `LoginForm.test.tsx`
- Create: `frontend/src/modules/auth/hooks.test.ts`
- Create: `frontend/src/app/login/page.tsx`, `src/app/(panel)/layout.tsx`, `src/app/(panel)/page.tsx` (placeholder)
- Create: `frontend/src/components/AppNav.tsx`; Modify: `src/components/index.ts`
- Delete: `frontend/src/app/page.tsx`

**Interfaces:**

- Consumes: `api`, `QUERY_KEYS`, `ROUTES`, `Session`, `@ui`.
- Produces (via `@/modules/auth` barrel): `login`, `logout`, `fetchMe`; `useMe()`, `useLogin()` (invalidate `me`, push dashboard), `useLogout()` (clear cache, push login); `<LoginForm/>`. Plus `<AppNav/>` (in `@components`) and the `(panel)` auth-gated layout.

- [ ] **Step 1: api + barrel**

`frontend/src/modules/auth/api.ts`:

```ts
import { api } from '@/lib/api-client';
import type { Session } from '@/types';

export function login(body: {
  username: string;
  password: string;
}): Promise<Session> {
  return api<Session>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function logout(): Promise<void> {
  return api<void>('/auth/logout', { method: 'POST' });
}

export function fetchMe(): Promise<Session> {
  return api<Session>('/auth/me');
}
```

`frontend/src/modules/auth/index.ts`:

```ts
export { useMe, useLogin, useLogout } from './hooks';
export { LoginForm } from './components/LoginForm';
```

- [ ] **Step 2: Failing hooks test**

`frontend/src/modules/auth/hooks.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import * as authApi from './api';
import { useMe } from './hooks';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe('useMe', () => {
  afterEach(() => jest.restoreAllMocks());
  it('returns the session', async () => {
    jest
      .spyOn(authApi, 'fetchMe')
      .mockResolvedValue({ id: 'u1', username: 'admin' });
    const { result } = renderHook(() => useMe(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.username).toBe('admin'));
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement hooks**

`frontend/src/modules/auth/hooks.ts`:

```ts
'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { QUERY_KEYS, ROUTES } from '@/constants';
import type { Session } from '@/types';
import { fetchMe, login, logout } from './api';

export function useMe() {
  return useQuery<Session>({ queryKey: QUERY_KEYS.me, queryFn: fetchMe });
}

export function useLogin() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: login,
    onSuccess: (session) => {
      qc.setQueryData(QUERY_KEYS.me, session);
      router.push(ROUTES.dashboard);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      qc.clear();
      router.push(ROUTES.login);
    },
  });
}
```

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: LoginForm test + component**

`frontend/src/modules/auth/components/LoginForm.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as authApi from '../api';
import { LoginForm } from './LoginForm';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LoginForm />
    </QueryClientProvider>,
  );
}

describe('LoginForm', () => {
  afterEach(() => jest.restoreAllMocks());

  it('submits credentials and redirects on success', async () => {
    const spy = jest
      .spyOn(authApi, 'login')
      .mockResolvedValue({ id: 'u1', username: 'admin' });
    renderForm();
    await userEvent.type(screen.getByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ username: 'admin', password: 'pw' }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));
  });

  it('shows an error on failed login', async () => {
    jest.spyOn(authApi, 'login').mockRejectedValue(new Error('Invalid'));
    renderForm();
    await userEvent.type(screen.getByLabelText('Username'), 'x');
    await userEvent.type(screen.getByLabelText('Password'), 'y');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });
});
```

`frontend/src/modules/auth/components/LoginForm.tsx`:

```tsx
'use client';
import { useState, type FormEvent } from 'react';
import { Button, Card, Input } from '@ui';
import { useLogin } from '../hooks';

export function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { mutate, isPending, isError } = useLogin();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutate({ username, password });
  }

  return (
    <Card className="w-80">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {isError && <p className="text-sm text-red-400">Invalid credentials</p>}
        <Button type="submit" loading={isPending}>
          Log in
        </Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 7: Run — expect PASS.**

- [ ] **Step 8: Pages, nav, layout guard**

`frontend/src/app/login/page.tsx`:

```tsx
import { LoginForm } from '@/modules/auth';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <LoginForm />
    </main>
  );
}
```

`frontend/src/components/AppNav.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { ROUTES } from '@/constants';
import { Button } from '@ui';
import { useLogout, useMe } from '@/modules/auth';

export function AppNav() {
  const { data: me } = useMe();
  const { mutate: logout, isPending } = useLogout();
  return (
    <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
      <Link href={ROUTES.dashboard} className="font-semibold">
        mc-panel
      </Link>
      <div className="flex items-center gap-3 text-sm text-neutral-400">
        {me && <span>{me.username}</span>}
        <Button variant="ghost" onClick={() => logout()} loading={isPending}>
          Log out
        </Button>
      </div>
    </header>
  );
}
```

Add to `frontend/src/components/index.ts`:

```ts
export { AppNav } from './AppNav';
```

`frontend/src/app/(panel)/layout.tsx`:

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ROUTES } from '@/constants';
import { Spinner } from '@ui';
import { AppNav } from '@components';
import { useMe } from '@/modules/auth';

export default function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data, isLoading, isError } = useMe();

  useEffect(() => {
    if (isError) router.replace(ROUTES.login);
  }, [isError, router]);

  if (isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  if (!data) return null;

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="p-6">{children}</main>
    </div>
  );
}
```

`frontend/src/app/(panel)/page.tsx` (placeholder — replaced in Task 5):

```tsx
export default function DashboardPlaceholder() {
  return <p>Dashboard</p>;
}
```

Delete `frontend/src/app/page.tsx`.

- [ ] **Step 9: Verify + commit**

Run: `pnpm --filter ./frontend test && pnpm --filter ./frontend typecheck && pnpm --filter ./frontend lint && pnpm --filter ./frontend build`.

```bash
git add frontend/src
git rm frontend/src/app/page.tsx
git commit -m "feat: add auth module, login page, and authenticated panel layout"
```

---

### Task 5: Servers module — dashboard cards + lifecycle

**Files:**

- Create: `frontend/src/modules/servers/api.ts`, `hooks.ts`, `constants.ts`, `index.ts`
- Create: `frontend/src/modules/servers/components/ServerCard.tsx`, `LifecycleButtons.tsx`, `StatusBadge.tsx`
- Create: `frontend/src/modules/servers/hooks.test.ts`, `components/ServerCard.test.tsx`
- Replace: `frontend/src/app/(panel)/page.tsx` (real dashboard)

**Interfaces:**

- Consumes: `api`, `QUERY_KEYS`, types, `@ui`, `ROUTES`.
- Produces (via `@/modules/servers`): `listServers/getServer/createServer/startServer/stopServer/restartServer/deleteServer`, `CreateServerBody`; `useServers()`, `useServer(id)`, `useServerLifecycle()` (invalidate `servers` + `server(id)`), `useCreateServer()`, `useDeleteServer()`; `<ServerCard server metricsSlot?/>`, `<LifecycleButtons server/>`, `<StatusBadge status/>`; `STATUS_TONE`.

- [ ] **Step 1: api + constants + barrel**

`frontend/src/modules/servers/api.ts`:

```ts
import { api } from '@/lib/api-client';
import type { PublicServer, ServerDetail, Loader } from '@/types';

export interface CreateServerBody {
  name: string;
  loader: Loader;
  version: string;
  ramMb: number;
  port: number;
}

export const listServers = () => api<PublicServer[]>('/servers');
export const getServer = (id: string) => api<ServerDetail>(`/servers/${id}`);
export const createServer = (body: CreateServerBody) =>
  api<PublicServer>('/servers', { method: 'POST', body: JSON.stringify(body) });
export const startServer = (id: string) =>
  api<PublicServer>(`/servers/${id}/start`, { method: 'POST' });
export const stopServer = (id: string) =>
  api<PublicServer>(`/servers/${id}/stop`, { method: 'POST' });
export const restartServer = (id: string) =>
  api<PublicServer>(`/servers/${id}/restart`, { method: 'POST' });
export const deleteServer = (id: string) =>
  api<void>(`/servers/${id}`, { method: 'DELETE' });
```

`frontend/src/modules/servers/constants.ts`:

```ts
import type { ServerStatus } from '@/types';

export const STATUS_TONE: Record<
  ServerStatus,
  'green' | 'gray' | 'red' | 'yellow'
> = {
  running: 'green',
  stopped: 'gray',
  creating: 'yellow',
  failed: 'red',
};
```

`frontend/src/modules/servers/index.ts`:

```ts
export * from './hooks';
export type { CreateServerBody } from './api';
export { ServerCard } from './components/ServerCard';
export { LifecycleButtons } from './components/LifecycleButtons';
export { StatusBadge } from './components/StatusBadge';
```

- [ ] **Step 2: Failing hooks test**

`frontend/src/modules/servers/hooks.test.ts`:

```ts
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import * as serversApi from './api';
import { useServers, useServerLifecycle } from './hooks';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

describe('servers hooks', () => {
  afterEach(() => jest.restoreAllMocks());

  it('useServers returns the list', async () => {
    jest
      .spyOn(serversApi, 'listServers')
      .mockResolvedValue([{ id: 's1', name: 'a' } as never]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useServers(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it('lifecycle start invalidates the servers query', async () => {
    jest
      .spyOn(serversApi, 'startServer')
      .mockResolvedValue({ id: 's1' } as never);
    const { client, wrapper } = makeWrapper();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useServerLifecycle(), { wrapper });
    await act(async () => {
      await result.current.start.mutateAsync('s1');
    });
    expect(invalidate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement hooks**

`frontend/src/modules/servers/hooks.ts`:

```ts
'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import type { PublicServer, ServerDetail } from '@/types';
import {
  createServer,
  deleteServer,
  getServer,
  listServers,
  restartServer,
  startServer,
  stopServer,
} from './api';

export function useServers() {
  return useQuery<PublicServer[]>({
    queryKey: QUERY_KEYS.servers,
    queryFn: listServers,
  });
}

export function useServer(id: string) {
  return useQuery<ServerDetail>({
    queryKey: QUERY_KEYS.server(id),
    queryFn: () => getServer(id),
  });
}

export function useServerLifecycle() {
  const qc = useQueryClient();
  const invalidate = (id: string) => {
    void qc.invalidateQueries({ queryKey: QUERY_KEYS.servers });
    void qc.invalidateQueries({ queryKey: QUERY_KEYS.server(id) });
  };
  return {
    start: useMutation({
      mutationFn: startServer,
      onSuccess: (s) => invalidate(s.id),
    }),
    stop: useMutation({
      mutationFn: stopServer,
      onSuccess: (s) => invalidate(s.id),
    }),
    restart: useMutation({
      mutationFn: restartServer,
      onSuccess: (s) => invalidate(s.id),
    }),
  };
}

export function useCreateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createServer,
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.servers }),
  });
}

export function useDeleteServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteServer,
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.servers }),
  });
}
```

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Components (+ ServerCard test)**

`frontend/src/modules/servers/components/StatusBadge.tsx`:

```tsx
import { Badge } from '@ui';
import type { ServerStatus } from '@/types';
import { STATUS_TONE } from '../constants';

export function StatusBadge({ status }: { status: ServerStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}
```

`frontend/src/modules/servers/components/LifecycleButtons.tsx`:

```tsx
'use client';
import { Button } from '@ui';
import type { PublicServer } from '@/types';
import { useServerLifecycle } from '../hooks';

export function LifecycleButtons({ server }: { server: PublicServer }) {
  const { start, stop, restart } = useServerLifecycle();
  const running = server.status === 'running';
  return (
    <div className="flex gap-2">
      <Button
        variant="ghost"
        disabled={running}
        loading={start.isPending}
        onClick={() => start.mutate(server.id)}
      >
        Start
      </Button>
      <Button
        variant="ghost"
        disabled={!running}
        loading={stop.isPending}
        onClick={() => stop.mutate(server.id)}
      >
        Stop
      </Button>
      <Button
        variant="ghost"
        loading={restart.isPending}
        onClick={() => restart.mutate(server.id)}
      >
        Restart
      </Button>
    </div>
  );
}
```

`frontend/src/modules/servers/components/ServerCard.tsx`:

```tsx
import Link from 'next/link';
import { Card, Badge } from '@ui';
import { ROUTES } from '@/constants';
import type { PublicServer } from '@/types';
import { StatusBadge } from './StatusBadge';
import { LifecycleButtons } from './LifecycleButtons';

export function ServerCard({
  server,
  metricsSlot,
}: {
  server: PublicServer;
  metricsSlot?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <Link
          href={ROUTES.server(server.id)}
          className="font-medium hover:underline"
        >
          {server.name}
        </Link>
        <StatusBadge status={server.status} />
      </div>
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <Badge tone="gray">{server.loader}</Badge>
        <span>{server.version}</span>
        <span>· :{server.port}</span>
      </div>
      {metricsSlot}
      <LifecycleButtons server={server} />
    </Card>
  );
}
```

`frontend/src/modules/servers/components/ServerCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServerCard } from './ServerCard';
import type { PublicServer } from '@/types';

const server: PublicServer = {
  id: 's1',
  name: 'survival',
  loader: 'paper',
  version: '1.20.1',
  ramMb: 2048,
  port: 25565,
  containerId: 'c1',
  status: 'running',
  createdAt: new Date(0).toISOString(),
};

it('renders name, loader, version and status', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServerCard server={server} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('survival')).toBeInTheDocument();
  expect(screen.getByText('paper')).toBeInTheDocument();
  expect(screen.getByText('1.20.1')).toBeInTheDocument();
  expect(screen.getByText('running')).toBeInTheDocument();
});
```

- [ ] **Step 7: Dashboard page**

Replace `frontend/src/app/(panel)/page.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { ROUTES } from '@/constants';
import { Button, Spinner } from '@ui';
import { useServers, ServerCard } from '@/modules/servers';

export default function Dashboard() {
  const { data: servers, isLoading, isError } = useServers();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Servers</h1>
        <Link href={ROUTES.newServer}>
          <Button>New server</Button>
        </Link>
      </div>
      {isLoading && <Spinner />}
      {isError && <p className="text-red-400">Failed to load servers.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {servers?.map((s) => (
          <ServerCard key={s.id} server={s} metricsSlot={null} />
        ))}
      </div>
      {servers?.length === 0 && (
        <p className="text-neutral-400">No servers yet. Create one.</p>
      )}
    </div>
  );
}
```

> `metricsSlot={null}` for now — Task 6 re-edits this file to pass `<LiveCpuRam>`. Keeps this task's build green without a forward import.

- [ ] **Step 8: Verify + commit**

Run: `pnpm --filter ./frontend test && pnpm --filter ./frontend typecheck && pnpm --filter ./frontend lint && pnpm --filter ./frontend build`.

```bash
git add frontend/src
git commit -m "feat: add servers module with dashboard cards and lifecycle controls"
```

---

### Task 6: Metrics module — live CPU/RAM (dashboard + detail tab)

**Files:**

- Create: `frontend/src/modules/metrics/socket.ts`, `hooks.ts`, `index.ts`
- Create: `frontend/src/modules/metrics/components/LiveCpuRam.tsx`, `MetricsTab.tsx`
- Create: `frontend/src/modules/metrics/hooks.test.ts`
- Modify: `frontend/src/app/(panel)/page.tsx` (wire `LiveCpuRam`)

**Interfaces:**

- Consumes: `makeSocket`, `SOCKET_EVENTS`, `ServerStats`, `@ui`.
- Produces (via `@/modules/metrics`): `subscribeStats(serverId, cb): () => void` (one shared `/metrics` socket, ref-counted rooms, re-joins on reconnect); `useServerStats(serverId): ServerStats | null`; `<LiveCpuRam serverId/>`, `<MetricsTab serverId/>`.

- [ ] **Step 1: Shared metrics socket manager**

`frontend/src/modules/metrics/socket.ts`:

```ts
import type { Socket } from 'socket.io-client';
import { makeSocket } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/constants';
import type { ServerStats } from '@/types';

type Listener = (stats: ServerStats) => void;

let socket: Socket | null = null;
const listeners = new Map<string, Set<Listener>>();

function ensureSocket(): Socket {
  if (socket) return socket;
  socket = makeSocket('/metrics');
  socket.on(SOCKET_EVENTS.stats, (payload: ServerStats) => {
    listeners.get(payload.serverId)?.forEach((cb) => cb(payload));
  });
  socket.on('connect', () => {
    // Re-join every active room after a (re)connect.
    for (const serverId of listeners.keys()) {
      socket?.emit(SOCKET_EVENTS.join, { serverId });
    }
  });
  return socket;
}

export function subscribeStats(serverId: string, cb: Listener): () => void {
  const s = ensureSocket();
  let set = listeners.get(serverId);
  if (!set) {
    set = new Set();
    listeners.set(serverId, set);
    s.emit(SOCKET_EVENTS.join, { serverId });
  }
  set.add(cb);

  return () => {
    const cur = listeners.get(serverId);
    if (!cur) return;
    cur.delete(cb);
    if (cur.size === 0) {
      listeners.delete(serverId);
      s.emit(SOCKET_EVENTS.leave, { serverId });
    }
    if (listeners.size === 0) {
      s.disconnect();
      socket = null;
    }
  };
}
```

> `ponytail: one shared /metrics socket, ref-counted rooms; disconnect on zero listeners. If unmount/remount churn causes reconnect thrash, add a short idle grace timer before disconnect.`

- [ ] **Step 2: Failing hook test**

`frontend/src/modules/metrics/hooks.test.ts`:

```ts
import { renderHook, act, waitFor } from '@testing-library/react';
import * as socketMod from './socket';
import { useServerStats } from './hooks';
import type { ServerStats } from '@/types';

describe('useServerStats', () => {
  afterEach(() => jest.restoreAllMocks());

  it('updates on a stats event and unsubscribes on unmount', async () => {
    let emit: (s: ServerStats) => void = () => {};
    const unsub = jest.fn();
    jest.spyOn(socketMod, 'subscribeStats').mockImplementation((_id, cb) => {
      emit = cb;
      return unsub;
    });

    const { result, unmount } = renderHook(() => useServerStats('s1'));
    expect(result.current).toBeNull();

    act(() => {
      emit({
        serverId: 's1',
        cpuPct: 40,
        memUsedMb: 300,
        memLimitMb: 2048,
        diskMb: 12,
      });
    });
    await waitFor(() => expect(result.current?.cpuPct).toBe(40));

    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement hook + barrel**

`frontend/src/modules/metrics/hooks.ts`:

```ts
'use client';
import { useEffect, useState } from 'react';
import type { ServerStats } from '@/types';
import { subscribeStats } from './socket';

export function useServerStats(serverId: string): ServerStats | null {
  const [stats, setStats] = useState<ServerStats | null>(null);
  useEffect(() => {
    setStats(null);
    return subscribeStats(serverId, setStats);
  }, [serverId]);
  return stats;
}
```

`frontend/src/modules/metrics/index.ts`:

```ts
export { useServerStats } from './hooks';
export { LiveCpuRam } from './components/LiveCpuRam';
export { MetricsTab } from './components/MetricsTab';
```

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Components**

`frontend/src/modules/metrics/components/LiveCpuRam.tsx`:

```tsx
'use client';
import { useServerStats } from '../hooks';

export function LiveCpuRam({ serverId }: { serverId: string }) {
  const stats = useServerStats(serverId);
  if (!stats)
    return <div className="text-xs text-neutral-500">connecting…</div>;
  return (
    <div className="flex gap-4 text-xs text-neutral-300">
      <span>CPU {stats.cpuPct.toFixed(0)}%</span>
      <span>
        RAM {stats.memUsedMb}/{stats.memLimitMb} MB
      </span>
    </div>
  );
}
```

`frontend/src/modules/metrics/components/MetricsTab.tsx`:

```tsx
'use client';
import { Card } from '@ui';
import { useServerStats } from '../hooks';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </Card>
  );
}

export function MetricsTab({ serverId }: { serverId: string }) {
  const stats = useServerStats(serverId);
  if (!stats) return <p className="text-neutral-400">Waiting for stats…</p>;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Metric label="CPU" value={`${stats.cpuPct.toFixed(0)}%`} />
      <Metric
        label="Memory"
        value={`${stats.memUsedMb} / ${stats.memLimitMb} MB`}
      />
      <Metric label="Disk" value={`${stats.diskMb} MB`} />
    </div>
  );
}
```

- [ ] **Step 7: Wire dashboard**

Edit `frontend/src/app/(panel)/page.tsx`: add `import { LiveCpuRam } from '@/modules/metrics';` and change the slot:

```tsx
metricsSlot={s.status === 'running' ? <LiveCpuRam serverId={s.id} /> : null}
```

- [ ] **Step 8: Verify + commit**

Run: `pnpm --filter ./frontend test && pnpm --filter ./frontend typecheck && pnpm --filter ./frontend lint && pnpm --filter ./frontend build`.

```bash
git add frontend/src
git commit -m "feat: add metrics module with live cpu/ram on cards and metrics tab"
```

---

### Task 7: Versions module + Create wizard

**Files:**

- Create: `frontend/src/modules/versions/api.ts`, `hooks.ts`, `index.ts`
- Create: `frontend/src/modules/versions/components/VersionSelect.tsx`
- Create: `frontend/src/modules/servers/components/CreateWizard.tsx`, `CreateWizard.test.tsx`; Modify: `src/modules/servers/index.ts`
- Create: `frontend/src/app/(panel)/servers/new/page.tsx`

**Interfaces:**

- Consumes: `api`, `QUERY_KEYS`, `LOADERS`, `Loader`, `useCreateServer`, `@ui`.
- Produces: `fetchVersions(loader)`, `useVersions(loader)` (via `@/modules/versions`); `<VersionSelect loader value onChange/>`; `<CreateWizard/>` (via `@/modules/servers`).

- [ ] **Step 1: versions api + hook + barrel**

`frontend/src/modules/versions/api.ts`:

```ts
import { api } from '@/lib/api-client';

export const fetchVersions = (loader: string) =>
  api<string[]>(`/versions/${loader}`);
```

`frontend/src/modules/versions/hooks.ts`:

```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import { fetchVersions } from './api';

export function useVersions(loader: string) {
  return useQuery<string[]>({
    queryKey: QUERY_KEYS.versions(loader),
    queryFn: () => fetchVersions(loader),
    enabled: Boolean(loader),
  });
}
```

`frontend/src/modules/versions/index.ts`:

```ts
export { useVersions } from './hooks';
export { VersionSelect } from './components/VersionSelect';
```

- [ ] **Step 2: VersionSelect**

`frontend/src/modules/versions/components/VersionSelect.tsx`:

```tsx
'use client';
import { Select } from '@ui';
import { useVersions } from '../hooks';

export function VersionSelect({
  loader,
  value,
  onChange,
}: {
  loader: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { data, isLoading } = useVersions(loader);
  const options = (data ?? []).map((v) => ({ value: v, label: v }));
  return (
    <Select
      label={isLoading ? 'Version (loading…)' : 'Version'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
      disabled={isLoading || options.length === 0}
    />
  );
}
```

- [ ] **Step 3: Failing wizard test**

`frontend/src/modules/servers/components/CreateWizard.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as serversApi from '../api';
import * as versionsApi from '@/modules/versions/api';
import { CreateWizard } from './CreateWizard';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

function renderWizard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CreateWizard />
    </QueryClientProvider>,
  );
}

describe('CreateWizard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('creates a server and navigates to its detail page', async () => {
    jest
      .spyOn(versionsApi, 'fetchVersions')
      .mockResolvedValue(['1.20.1', '1.20.2']);
    const create = jest
      .spyOn(serversApi, 'createServer')
      .mockResolvedValue({ id: 'new1' } as never);

    renderWizard();
    await userEvent.type(screen.getByLabelText('Name'), 'survival');
    await waitFor(() =>
      expect(screen.getByLabelText('Version')).not.toBeDisabled(),
    );
    await userEvent.selectOptions(screen.getByLabelText('Version'), '1.20.1');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'survival',
          loader: 'vanilla',
          version: '1.20.1',
        }),
      ),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/servers/new1'));
  });
});
```

- [ ] **Step 4: Run — expect FAIL.**

- [ ] **Step 5: Implement CreateWizard + export**

`frontend/src/modules/servers/components/CreateWizard.tsx`:

```tsx
'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Input, Select } from '@ui';
import { LOADERS, ROUTES } from '@/constants';
import type { Loader } from '@/types';
import { VersionSelect, useVersions } from '@/modules/versions';
import { useCreateServer } from '../hooks';

export function CreateWizard() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loader, setLoader] = useState<Loader>('vanilla');
  const [version, setVersion] = useState('');
  const [ramMb, setRamMb] = useState(2048);
  const [port, setPort] = useState(25565);
  const { data: versions } = useVersions(loader);
  const { mutate, isPending, isError, error } = useCreateServer();

  // Default the version to the first available whenever the loader changes.
  useEffect(() => {
    if (versions && versions.length > 0) setVersion(versions[0]);
  }, [versions]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutate(
      { name, loader, version, ramMb, port },
      { onSuccess: (created) => router.push(ROUTES.server(created.id)) },
    );
  }

  return (
    <Card className="max-w-md">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">New server</h1>
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Select
          label="Loader"
          value={loader}
          onChange={(e) => setLoader(e.target.value as Loader)}
          options={LOADERS.map((l) => ({ value: l, label: l }))}
        />
        <VersionSelect loader={loader} value={version} onChange={setVersion} />
        <Input
          label="RAM (MB)"
          type="number"
          value={ramMb}
          onChange={(e) => setRamMb(Number(e.target.value))}
          min={512}
          step={512}
        />
        <Input
          label="Port"
          type="number"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
          min={1024}
          max={65535}
        />
        {isError && (
          <p className="text-sm text-red-400">
            {(error as Error)?.message ?? 'Failed to create server'}
          </p>
        )}
        <Button type="submit" loading={isPending} disabled={!name || !version}>
          Create
        </Button>
      </form>
    </Card>
  );
}
```

Add to `frontend/src/modules/servers/index.ts`:

```ts
export { CreateWizard } from './components/CreateWizard';
```

- [ ] **Step 6: Run — expect PASS.**

- [ ] **Step 7: New-server page**

`frontend/src/app/(panel)/servers/new/page.tsx`:

```tsx
import { CreateWizard } from '@/modules/servers';

export default function NewServerPage() {
  return <CreateWizard />;
}
```

- [ ] **Step 8: Verify + commit**

Run: `pnpm --filter ./frontend test && pnpm --filter ./frontend typecheck && pnpm --filter ./frontend lint && pnpm --filter ./frontend build`.

```bash
git add frontend/src
git commit -m "feat: add versions module and create-server wizard"
```

---

### Task 8: Console module + server detail page (tabs + settings)

**Files:**

- Create: `frontend/src/modules/console/hooks.ts`, `index.ts`
- Create: `frontend/src/modules/console/components/ConsoleTab.tsx`
- Create: `frontend/src/modules/console/hooks.test.ts`
- Create: `frontend/src/modules/servers/components/SettingsTab.tsx`; Modify: `src/modules/servers/index.ts`
- Create: `frontend/src/app/(panel)/servers/[id]/page.tsx`

**Interfaces:**

- Consumes: `makeSocket`, `SOCKET_EVENTS`, `useServer`, `useDeleteServer`, `@ui`, `ConsoleLog`, `ConsoleOutput`.
- Produces (via `@/modules/console`): `useConsole(serverId)` → `{ lines: string[], send(cmd): void, connected: boolean }`; `<ConsoleTab serverId/>`. Plus `<SettingsTab server/>` (via `@/modules/servers`) and the server-detail page (Tabs console|metrics|settings).

- [ ] **Step 1: Failing console hook test**

`frontend/src/modules/console/hooks.test.ts`:

```ts
import { renderHook, act, waitFor } from '@testing-library/react';
import * as socketLib from '@/lib/socket';
import { useConsole } from './hooks';

type Handler = (payload: unknown) => void;

function makeFakeSocket() {
  const handlers: Record<string, Handler[]> = {};
  const sent: { event: string; payload: unknown }[] = [];
  return {
    on(event: string, cb: Handler) {
      (handlers[event] ??= []).push(cb);
    },
    emit(event: string, payload?: unknown) {
      sent.push({ event, payload });
    },
    disconnect: jest.fn(),
    fire(event: string, payload?: unknown) {
      (handlers[event] ?? []).forEach((cb) => cb(payload));
    },
    sent,
  };
}

describe('useConsole', () => {
  afterEach(() => jest.restoreAllMocks());

  it('joins on connect, appends lines, sends commands, leaves on unmount', async () => {
    const fake = makeFakeSocket();
    jest.spyOn(socketLib, 'makeSocket').mockReturnValue(fake as never);

    const { result, unmount } = renderHook(() => useConsole('s1'));

    act(() => fake.fire('connect'));
    expect(fake.sent).toContainEqual({
      event: 'join',
      payload: { serverId: 's1' },
    });

    act(() => fake.fire('log', { serverId: 's1', line: 'Server started!' }));
    await waitFor(() =>
      expect(result.current.lines).toContain('Server started!'),
    );

    act(() => result.current.send('list'));
    expect(fake.sent).toContainEqual({
      event: 'command',
      payload: { serverId: 's1', command: 'list' },
    });

    act(() => fake.fire('output', { serverId: 's1', output: '0 players' }));
    await waitFor(() => expect(result.current.lines).toContain('0 players'));

    unmount();
    expect(fake.sent).toContainEqual({
      event: 'leave',
      payload: { serverId: 's1' },
    });
    expect(fake.disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement console hook + barrel**

`frontend/src/modules/console/hooks.ts`:

```ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { makeSocket } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/constants';
import type { ConsoleLog, ConsoleOutput } from '@/types';

const MAX_LINES = 2000;

export function useConsole(serverId: string) {
  const socketRef = useRef<Socket | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  const append = useCallback((line: string) => {
    setLines((prev) => {
      const next = prev.length >= MAX_LINES ? prev.slice(1) : prev;
      return [...next, line];
    });
  }, []);

  useEffect(() => {
    const socket = makeSocket('/console');
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit(SOCKET_EVENTS.join, { serverId });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on(SOCKET_EVENTS.log, (p: ConsoleLog) => append(p.line));
    socket.on(SOCKET_EVENTS.output, (p: ConsoleOutput) => append(p.output));
    socket.on(SOCKET_EVENTS.error, (p: { message: string }) =>
      append(`[error] ${p.message}`),
    );

    return () => {
      socket.emit(SOCKET_EVENTS.leave, { serverId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverId, append]);

  const send = useCallback(
    (command: string) => {
      socketRef.current?.emit(SOCKET_EVENTS.command, { serverId, command });
    },
    [serverId],
  );

  return { lines, send, connected };
}
```

`frontend/src/modules/console/index.ts`:

```ts
export { useConsole } from './hooks';
export { ConsoleTab } from './components/ConsoleTab';
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: ConsoleTab (xterm)**

`frontend/src/modules/console/components/ConsoleTab.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Button, Input } from '@ui';
import { useConsole } from '../hooks';

export function ConsoleTab({ serverId }: { serverId: string }) {
  const { lines, send, connected } = useConsole(serverId);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const writtenRef = useRef(0);
  const [command, setCommand] = useState('');

  useEffect(() => {
    if (!mountRef.current) return;
    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      theme: { background: '#0a0a0a' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(mountRef.current);
    fit.fit();
    termRef.current = term;
    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
      writtenRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    for (let i = writtenRef.current; i < lines.length; i++) {
      term.writeln(lines[i]);
    }
    writtenRef.current = lines.length;
  }, [lines]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!command.trim()) return;
    send(command);
    setCommand('');
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-neutral-500">
        {connected ? 'connected' : 'connecting…'}
      </div>
      <div
        ref={mountRef}
        className="h-96 w-full overflow-hidden rounded-md border border-neutral-800 bg-black p-2"
      />
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          className="flex-1"
          placeholder="Type a command (e.g. list)"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        <Button type="submit" disabled={!connected}>
          Send
        </Button>
      </form>
    </div>
  );
}
```

> xterm touches `window`; it runs only inside `useEffect` in a `'use client'` component, so SSR never hits DOM APIs — no `next/dynamic` needed.

- [ ] **Step 6: SettingsTab + export**

`frontend/src/modules/servers/components/SettingsTab.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@ui';
import { ROUTES } from '@/constants';
import type { PublicServer } from '@/types';
import { useDeleteServer } from '../hooks';

export function SettingsTab({ server }: { server: PublicServer }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { mutate: remove, isPending } = useDeleteServer();

  const rows: [string, string | number][] = [
    ['Loader', server.loader],
    ['Version', server.version],
    ['RAM (MB)', server.ramMb],
    ['Port', server.port],
    ['Status', server.status],
  ];

  return (
    <div className="flex max-w-md flex-col gap-4">
      <Card className="flex flex-col gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-neutral-400">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </Card>
      <Card className="flex flex-col gap-3">
        <span className="text-sm font-medium text-red-400">Danger zone</span>
        {!confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete server
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="danger"
              loading={isPending}
              onClick={() =>
                remove(server.id, {
                  onSuccess: () => router.push(ROUTES.dashboard),
                })
              }
            >
              Confirm delete
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
```

Add to `frontend/src/modules/servers/index.ts`:

```ts
export { SettingsTab } from './components/SettingsTab';
```

- [ ] **Step 7: Server detail page**

`frontend/src/app/(panel)/servers/[id]/page.tsx`:

```tsx
'use client';
import { use, useState } from 'react';
import { Spinner, Tabs } from '@ui';
import {
  useServer,
  StatusBadge,
  LifecycleButtons,
  SettingsTab,
} from '@/modules/servers';
import { ConsoleTab } from '@/modules/console';
import { MetricsTab } from '@/modules/metrics';

type TabKey = 'console' | 'metrics' | 'settings';

export default function ServerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tab, setTab] = useState<TabKey>('console');
  const { data: server, isLoading, isError } = useServer(id);

  if (isLoading) return <Spinner />;
  if (isError || !server)
    return <p className="text-red-400">Server not found.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{server.name}</h1>
          <StatusBadge status={server.status} />
        </div>
        <LifecycleButtons server={server} />
      </div>
      <Tabs<TabKey>
        current={tab}
        onChange={setTab}
        tabs={[
          { key: 'console', label: 'Console' },
          { key: 'metrics', label: 'Metrics' },
          { key: 'settings', label: 'Settings' },
        ]}
      />
      {tab === 'console' && <ConsoleTab serverId={server.id} />}
      {tab === 'metrics' && <MetricsTab serverId={server.id} />}
      {tab === 'settings' && <SettingsTab server={server} />}
    </div>
  );
}
```

- [ ] **Step 8: Verify + commit**

Run: `pnpm --filter ./frontend test && pnpm --filter ./frontend typecheck && pnpm --filter ./frontend lint && pnpm --filter ./frontend build`.

```bash
git add frontend/src
git commit -m "feat: add live console, server detail tabs, and settings"
```

---

### Task 9: Boundaries (fallow) + Playwright e2e + gates

**Files:**

- Create: `frontend/.fallowrc.json`
- Create: `frontend/playwright.config.ts`, `frontend/e2e/mocks.ts`, `frontend/e2e/panel.spec.ts`
- Modify: root `package.json` (frontend aliases), `.husky/pre-push`, `AGENTS.md`

**Interfaces:**

- Produces: enforced layer boundaries (`fallow audit` in `frontend/`); a route-mocked Playwright suite (login → dashboard → wizard) that needs no Docker/live backend; frontend gates wired into pre-push (unit/typecheck/build; NOT e2e).

- [ ] **Step 1: fallow boundary zones**

`frontend/.fallowrc.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",
  "boundaries": {
    "zones": [
      {
        "name": "shared",
        "patterns": [
          "src/utils/**",
          "src/lib/**",
          "src/hooks/**",
          "src/types/**",
          "src/constants/**"
        ]
      },
      { "name": "ui", "patterns": ["src/ui/**"] },
      { "name": "components", "patterns": ["src/components/**"] },
      { "name": "modules", "patterns": ["src/modules/**"] },
      { "name": "app", "patterns": ["src/app/**"] }
    ],
    "rules": [
      { "from": "ui", "allow": ["ui", "shared"] },
      { "from": "shared", "allow": ["shared", "ui"] },
      { "from": "components", "allow": ["ui", "components", "shared"] },
      { "from": "modules", "allow": ["ui", "components", "shared", "modules"] },
      {
        "from": "app",
        "allow": ["ui", "components", "shared", "modules", "app"]
      }
    ]
  }
}
```

Run: `cd frontend && npx fallow audit` (or `pnpm dlx fallow audit`) → expect 0 boundary violations. If fallow isn't on PATH, skip (matches sense-frontend's "skipped if fallow isn't on PATH"); ESLint `no-restricted-imports` still guards module-ui privacy. Return to repo root afterward.

> If `fallow audit` flags `ui` importing `@/utils` (cn): that's `ui → shared`, which the rules allow. If it flags a real cross-layer violation, fix the import (lift shared code up, or route through a barrel) — do NOT widen the rules.

- [ ] **Step 2: Playwright config**

`frontend/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_API_URL: 'http://localhost:3001' },
  },
});
```

- [ ] **Step 3: Route mocks**

`frontend/e2e/mocks.ts`:

```ts
import type { Page } from '@playwright/test';

const server = {
  id: 's1',
  name: 'survival',
  loader: 'vanilla',
  version: '1.20.1',
  ramMb: 2048,
  port: 25565,
  containerId: 'c1',
  status: 'stopped',
  createdAt: new Date(0).toISOString(),
};

// Intercept the backend origin (NEXT_PUBLIC_API_URL → :3001) by path glob.
export async function mockBackend(page: Page) {
  await page.route('**/auth/me', (r) =>
    r.fulfill({ json: { id: 'u1', username: 'admin' } }),
  );
  await page.route('**/auth/login', (r) =>
    r.fulfill({ json: { id: 'u1', username: 'admin' } }),
  );
  await page.route('**/servers', (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({ json: { ...server, id: 'new1', name: 'created' } })
      : r.fulfill({ json: [server] }),
  );
  await page.route('**/servers/new1', (r) =>
    r.fulfill({ json: { ...server, id: 'new1', live: null } }),
  );
  await page.route('**/versions/**', (r) =>
    r.fulfill({ json: ['1.20.1', '1.20.2'] }),
  );
}
```

> Socket.io (`/console`, `/metrics`) is left unrouted; the pages under test (login, dashboard, wizard) render without a live socket — the dashboard card is `stopped`, so `LiveCpuRam` never mounts.

- [ ] **Step 4: Spec**

`frontend/e2e/panel.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { mockBackend } from './mocks';

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test('logs in and lands on the dashboard', async ({ page }) => {
  // First /auth/me is unauthenticated so the guard shows the login route.
  await page.route('**/auth/me', (r) => r.fulfill({ status: 401, body: '' }), {
    times: 1,
  });
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('pw');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible();
  await expect(page.getByText('survival')).toBeVisible();
});

test('creates a server through the wizard', async ({ page }) => {
  await page.goto('/servers/new');
  await page.getByLabel('Name').fill('created');
  await expect(page.getByLabel('Version')).toBeEnabled();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/servers\/new1$/);
});
```

- [ ] **Step 5: Install browser + run**

Run: `pnpm --filter ./frontend e2e:install`
Run: `pnpm --filter ./frontend e2e`
Expected: 2 passed.

- [ ] **Step 6: Root aliases + pre-push + AGENTS**

Add to root `package.json` scripts:

```json
"test:fe": "pnpm --filter ./frontend test",
"typecheck:fe": "pnpm --filter ./frontend typecheck",
"build:fe": "pnpm --filter ./frontend build"
```

Edit `.husky/pre-push` — append after the existing backend line (keep it intact):

```sh
pnpm --filter ./frontend typecheck && pnpm --filter ./frontend lint && pnpm --filter ./frontend test && pnpm --filter ./frontend build
```

> Playwright e2e is NOT in pre-push (needs a browser binary + built server — too slow for a push gate). Run manually / in CI.

Add a `## Frontend` section to root `AGENTS.md`:

```md
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
- Boundaries: `frontend/.fallowrc.json` zones + ESLint `no-restricted-imports`.
  A module's `ui/` is private — never import `@/modules/*/ui` from outside it.
```

- [ ] **Step 7: Full gate + commit**

Run: `pnpm --filter ./frontend typecheck && pnpm --filter ./frontend lint && pnpm --filter ./frontend test && pnpm --filter ./frontend build`.
Run: `pnpm --filter ./backend test && pnpm --filter ./backend test:e2e` → still green.

```bash
git add frontend/.fallowrc.json frontend/playwright.config.ts frontend/e2e .husky/pre-push package.json AGENTS.md
git commit -m "chore: add frontend boundaries, playwright e2e, and gates"
```

---

## Self-Review Notes

- **Spec coverage:** Login (Task 4); Dashboard cards + status + live CPU/RAM + lifecycle + New button (Tasks 5–6); Create wizard w/ live version dropdown (Task 7); Server detail Console/Metrics/Settings tabs (Tasks 6, 8); WS live data + reconnect (Task 6 metrics manager re-joins on connect; Task 8 console hook); cross-origin cookie auth (Tasks 1–2). All Phase-1 frontend rows mapped.
- **Reference alignment:** module `index.ts` barrels, `@ui`/`@components` aliases, `no-restricted-imports` for module-ui privacy, `.fallowrc.json` boundary zones, Jest via `next/jest`, `cn` util, exact Next/eslint-config-next 16.3.4 — all mirror `/ssd/work/sense/sense-frontend`. Deviation: **Tailwind v4** (sense uses v3) — chosen for simpler config; not an architectural convention.
- **Jest gotcha baked in:** `jest.mock('next/navigation', …)` factories reference `mockPush` (the `mock*` prefix is the only out-of-scope name Jest's hoisting allows) — used consistently in auth/wizard tests.
- **Deferred vs spec:** spec's E2E "start it, see console output, stop it" needs a live backend + Docker; Playwright here is route-mocked (Task 9), console/metrics WS behavior is unit-tested. Full Docker-backed e2e is a later CI job — flagged, not dropped.
- **Task ordering caveat:** Task 5's dashboard ships `metricsSlot={null}` (no forward import); Task 6 re-edits it to wire `LiveCpuRam`. Called out inline.
- **Type consistency:** `ServerStats` keys (`cpuPct`, `memUsedMb`, `memLimitMb`, `diskMb`) identical across types/hook/components/e2e mock; `PublicServer`/`ServerDetail` consistent across servers module + detail page. Verify against the real backend in Task 1 Step 1.
- **Version note:** Next 16 requires Node 20.9+. If the host Node is older it surfaces at Task 1 `pnpm install`/`build` — bump Node, don't downgrade Next.

```

```
