# Backend Foundation + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Nest.js backend with SQLite persistence and username/password auth (JWT in an httpOnly cookie), where accounts are created only by a server-side CLI script, using a controller → service → repository layering.

**Architecture:** A Nest.js (v11, CommonJS) application backed by Prisma 6 + SQLite. DB access is isolated in repository classes; services hold business logic; controllers are thin HTTP adapters. A `User` table stores username + bcrypt hash. A standalone CLI (run via a Nest application context, so it reuses `UsersService`) manages accounts — there is no HTTP route that creates users. Login issues a JWT set as an httpOnly cookie; a `JwtAuthGuard` protects routes by reading that cookie. Required env vars are validated by a shared `verifyEnv()` used both at boot and by a standalone `verify:env` script.

**Tech Stack:** Node 20+, pnpm, Nest.js 11, TypeScript 5.9, Prisma 6 + SQLite, `@nestjs/jwt`, `bcryptjs`, `cookie-parser`, `commander` (CLI), Jest + ts-jest + supertest (tests).

## Global Constraints

- **Package manager: pnpm.** All install/run commands use `pnpm`. Because pnpm blocks dependency build scripts by default, `package.json` must allowlist Prisma's postinstall (see Task 1).
- **Stack versions are pinned to stable:** TypeScript **5.9.x**, Prisma **6.19.x**, Nest **11.x**. Do NOT use TypeScript 7 or Prisma 7 — TS7 removed the programmatic compiler API that nest-cli requires (returns in 7.1), and Prisma 7's ESM-only client forces ESM friction. This is a deliberate decision recorded during a spike.
- **Module system: CommonJS** (`tsconfig` `module: commonjs`). Not ESM.
- Single Ubuntu host; SQLite for v1 (file at `prisma/dev.db`, path from `DATABASE_URL`).
- **No self-service signup and no HTTP route that creates users.** Accounts come only from the CLI.
- Auth: username + password only (no email). JWT stored in an **httpOnly** cookie named `mcp_token`.
- Passwords hashed with `bcryptjs` (pure-JS, no native build). Cost factor 12.
- **Layering rule:** controllers call services; services call repositories; only repositories import/use `PrismaService`. Nothing else touches Prisma directly.
- Required env vars `DATABASE_URL` and `JWT_SECRET` are validated by a shared `verifyEnv()`; the app refuses to boot if any is missing.
- Node 20+.

---

### Task 1: Scaffold Nest 11 + Prisma 6 + SQLite, env verification, and health check

**Files:**
- Create: `backend/package.json`
- Create: `backend/pnpm-workspace.yaml` (empty-ish; documents pnpm + build allowlist location)
- Create: `backend/tsconfig.json`
- Create: `backend/tsconfig.build.json`
- Create: `backend/nest-cli.json`
- Create: `backend/.env.example`
- Create: `backend/.env`
- Create: `backend/.gitignore`
- Create: `backend/prisma/schema.prisma`
- Create: `backend/src/config/env.ts`
- Test: `backend/src/config/env.spec.ts`
- Create: `backend/scripts/verify-env.ts`
- Create: `backend/src/prisma/prisma.service.ts`
- Create: `backend/src/prisma/prisma.module.ts`
- Create: `backend/src/health/health.controller.ts`
- Create: `backend/src/health/health.module.ts`
- Create: `backend/src/app.module.ts`
- Create: `backend/src/main.ts`
- Create: `backend/jest.config.js`
- Create: `backend/test/jest-e2e.json`
- Test: `backend/test/health.e2e-spec.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `verifyEnv(env?: NodeJS.ProcessEnv): void` in `config/env.ts` — throws `Error` listing any missing required vars. `REQUIRED_ENV: readonly ['DATABASE_URL', 'JWT_SECRET']`.
  - `PrismaService extends PrismaClient` (Nest injectable, connects on module init).
  - `PrismaModule` — global module exporting `PrismaService`.
  - Prisma `User` model: `{ id Int @id @default(autoincrement()), username String @unique, passwordHash String, createdAt DateTime @default(now()) }`.
  - Booted Nest app with `cookie-parser`, global `ValidationPipe`, and `GET /health` → `{ status: 'ok' }`.

- [ ] **Step 1: Create `backend/package.json`**

```json
{
  "name": "mc-panel-backend",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "verify:env": "ts-node scripts/verify-env.ts",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "user": "ts-node scripts/user.ts"
  },
  "dependencies": {
    "@nestjs/common": "^11.1.28",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.1.28",
    "@nestjs/jwt": "^11.0.0",
    "@nestjs/platform-express": "^11.1.28",
    "@prisma/client": "^6.19.3",
    "bcryptjs": "^2.4.3",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "commander": "^12.1.0",
    "cookie-parser": "^1.4.7",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.1.28",
    "@types/bcryptjs": "^2.4.6",
    "@types/cookie-parser": "^1.4.8",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^20.19.0",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "prisma": "^6.19.3",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "typescript": "^5.9.3"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["prisma", "@prisma/client", "@prisma/engines"]
  }
}
```

Note: `pnpm.onlyBuiltDependencies` allowlists Prisma's postinstall (engine setup); pnpm blocks dependency build scripts otherwise, and Prisma silently fails to generate without it.

- [ ] **Step 2: Create `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Create `backend/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

- [ ] **Step 4: Create `backend/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 5: Create `backend/.env.example` and `backend/.env`** (identical contents; `.env` is git-ignored)

```
DATABASE_URL="file:./dev.db"
JWT_SECRET="change-me-to-a-long-random-string"
NODE_ENV="development"
PORT="3001"
```

- [ ] **Step 6: Create `backend/.gitignore`**

```
node_modules/
dist/
.env
prisma/dev.db
prisma/dev.db-journal
*.log
```

- [ ] **Step 7: Create `backend/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id           Int      @id @default(autoincrement())
  username     String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
}
```

- [ ] **Step 8: Install deps and run the first migration**

Run (from `backend/`):
```bash
pnpm install
pnpm exec prisma migrate dev --name init
```
Expected: `prisma/migrations/*_init/migration.sql` created; `dev.db` created; `@prisma/client` generated with no errors. If generation is skipped, confirm the `pnpm.onlyBuiltDependencies` allowlist from Step 1 is present, then run `pnpm approve-builds` and re-run `pnpm install`.

- [ ] **Step 9: Write the failing unit test `backend/src/config/env.spec.ts`**

```typescript
import { verifyEnv } from './env';

describe('verifyEnv', () => {
  it('passes when all required vars are present', () => {
    expect(() =>
      verifyEnv({ DATABASE_URL: 'file:./x.db', JWT_SECRET: 's' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('throws listing every missing var', () => {
    expect(() => verifyEnv({} as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL.*JWT_SECRET/,
    );
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run (from `backend/`):
```bash
pnpm test -- env
```
Expected: FAIL — cannot find module `./env`.

- [ ] **Step 11: Create `backend/src/config/env.ts`**

```typescript
export const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'] as const;

export function verifyEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run (from `backend/`):
```bash
pnpm test -- env
```
Expected: PASS, 2 tests.

- [ ] **Step 13: Create `backend/scripts/verify-env.ts`**

```typescript
import { verifyEnv } from '../src/config/env';

try {
  verifyEnv();
  console.log('Env OK');
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
```

- [ ] **Step 14: Manually verify the env script**

Run (from `backend/`):
```bash
JWT_SECRET= DATABASE_URL= pnpm run verify:env   # expect error + exit 1
pnpm run verify:env                              # with .env present, expect "Env OK"
```
Note: `ts-node` does not auto-load `.env`; the second command relies on the shell having the vars, or run `env $(cat .env | xargs) pnpm run verify:env`. (The Nest app itself loads `.env` via `ConfigModule` in Step 18.)

- [ ] **Step 15: Create `backend/src/prisma/prisma.service.ts`**

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
}
```

- [ ] **Step 16: Create `backend/src/prisma/prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 17: Create `backend/src/health/health.controller.ts` and `health.module.ts`**

`health.controller.ts`:
```typescript
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
```

`health.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 18: Create `backend/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 19: Create `backend/src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { verifyEnv } from './config/env';

async function bootstrap(): Promise<void> {
  verifyEnv();
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
}
void bootstrap();
```

- [ ] **Step 20: Create `backend/jest.config.js` (unit tests, colocated in `src`)**

```javascript
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};
```

- [ ] **Step 21: Create `backend/test/jest-e2e.json`**

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" }
}
```

- [ ] **Step 22: Write the e2e test `backend/test/health.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 23: Run the e2e test**

Run (from `backend/`):
```bash
pnpm run test:e2e -- health
```
Expected: PASS, 1 test. (DB must be migrated from Step 8.)

- [ ] **Step 24: Commit**

```bash
git add backend/
git commit -m "feat(backend): scaffold Nest 11 + Prisma 6 + SQLite, env verify, health"
```

---

### Task 2: Users domain — repository + service + password util

**Files:**
- Create: `backend/src/auth/password.util.ts`
- Test: `backend/src/auth/password.util.spec.ts`
- Create: `backend/src/users/user.repository.ts`
- Create: `backend/src/users/users.service.ts`
- Create: `backend/src/users/users.module.ts`
- Test: `backend/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 1).
- Produces:
  - `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>` in `password.util.ts`.
  - `UserRepository` with: `findByUsername(username: string): Promise<UserRecord | null>`, `create(username: string, passwordHash: string): Promise<UserRecord>`, `updatePasswordHash(username: string, passwordHash: string): Promise<UserRecord>`, `delete(username: string): Promise<void>`, `list(): Promise<Pick<UserRecord, 'username' | 'createdAt'>[]>`. `UserRecord = { id: number; username: string; passwordHash: string; createdAt: Date }`.
  - `UsersService` with: `createUser(username: string, plainPassword: string): Promise<void>` (throws if username exists), `validateCredentials(username: string, plainPassword: string): Promise<{ id: number; username: string } | null>`, `resetPassword(username: string, newPassword: string): Promise<void>` (throws if not found), `deleteUser(username: string): Promise<void>` (throws if not found), `listUsers(): Promise<{ username: string; createdAt: Date }[]>`.
  - `UsersModule` exporting `UsersService` and `UserRepository`.

- [ ] **Step 1: Write the failing test `backend/src/auth/password.util.spec.ts`**

```typescript
import { hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash).not.toEqual('hunter2');
    expect(await verifyPassword('hunter2', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('hunter2');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- password.util`
Expected: FAIL — cannot find module `./password.util`.

- [ ] **Step 3: Create `backend/src/auth/password.util.ts`**

```typescript
import * as bcrypt from 'bcryptjs';

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- password.util`
Expected: PASS, 2 tests.

- [ ] **Step 5: Create `backend/src/users/user.repository.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: Date;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUsername(username: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  create(username: string, passwordHash: string): Promise<UserRecord> {
    return this.prisma.user.create({ data: { username, passwordHash } });
  }

  updatePasswordHash(
    username: string,
    passwordHash: string,
  ): Promise<UserRecord> {
    return this.prisma.user.update({
      where: { username },
      data: { passwordHash },
    });
  }

  async delete(username: string): Promise<void> {
    await this.prisma.user.delete({ where: { username } });
  }

  list(): Promise<Pick<UserRecord, 'username' | 'createdAt'>[]> {
    return this.prisma.user.findMany({
      select: { username: true, createdAt: true },
      orderBy: { username: 'asc' },
    });
  }
}
```

- [ ] **Step 6: Write the failing test `backend/src/users/users.service.spec.ts`** (repository mocked — pure business-logic test)

```typescript
import { UsersService } from './users.service';
import { UserRepository, UserRecord } from './user.repository';
import { hashPassword } from '../auth/password.util';

function makeRepoMock(): jest.Mocked<UserRepository> {
  return {
    findByUsername: jest.fn(),
    create: jest.fn(),
    updatePasswordHash: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
  } as unknown as jest.Mocked<UserRepository>;
}

describe('UsersService', () => {
  it('createUser throws when username already exists', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue({ id: 1 } as UserRecord);
    const svc = new UsersService(repo);
    await expect(svc.createUser('alice', 'pw')).rejects.toThrow(/exists/);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('createUser stores a bcrypt hash, not the plaintext', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue(null);
    const svc = new UsersService(repo);
    await svc.createUser('alice', 'pw');
    const [, storedHash] = repo.create.mock.calls[0];
    expect(storedHash).not.toEqual('pw');
    expect(await verifyStored(storedHash, 'pw')).toBe(true);
  });

  it('validateCredentials returns null for wrong password', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue({
      id: 1,
      username: 'alice',
      passwordHash: await hashPassword('right'),
      createdAt: new Date(),
    });
    const svc = new UsersService(repo);
    expect(await svc.validateCredentials('alice', 'wrong')).toBeNull();
  });

  it('validateCredentials returns id+username for correct password', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue({
      id: 7,
      username: 'alice',
      passwordHash: await hashPassword('right'),
      createdAt: new Date(),
    });
    const svc = new UsersService(repo);
    expect(await svc.validateCredentials('alice', 'right')).toEqual({
      id: 7,
      username: 'alice',
    });
  });
});

async function verifyStored(hash: string, plain: string): Promise<boolean> {
  const { verifyPassword } = await import('../auth/password.util');
  return verifyPassword(plain, hash);
}
```

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm test -- users.service`
Expected: FAIL — cannot find module `./users.service`.

- [ ] **Step 8: Create `backend/src/users/users.service.ts`**

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { hashPassword, verifyPassword } from '../auth/password.util';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UserRepository) {}

  async createUser(username: string, plainPassword: string): Promise<void> {
    const existing = await this.repo.findByUsername(username);
    if (existing) {
      throw new ConflictException(`User "${username}" already exists`);
    }
    await this.repo.create(username, await hashPassword(plainPassword));
  }

  async validateCredentials(
    username: string,
    plainPassword: string,
  ): Promise<{ id: number; username: string } | null> {
    const user = await this.repo.findByUsername(username);
    if (!user) return null;
    const ok = await verifyPassword(plainPassword, user.passwordHash);
    if (!ok) return null;
    return { id: user.id, username: user.username };
  }

  async resetPassword(username: string, newPassword: string): Promise<void> {
    const user = await this.repo.findByUsername(username);
    if (!user) throw new NotFoundException(`User "${username}" not found`);
    await this.repo.updatePasswordHash(username, await hashPassword(newPassword));
  }

  async deleteUser(username: string): Promise<void> {
    const user = await this.repo.findByUsername(username);
    if (!user) throw new NotFoundException(`User "${username}" not found`);
    await this.repo.delete(username);
  }

  listUsers(): Promise<{ username: string; createdAt: Date }[]> {
    return this.repo.list();
  }
}
```

- [ ] **Step 9: Create `backend/src/users/users.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRepository } from './user.repository';

@Module({
  providers: [UsersService, UserRepository],
  exports: [UsersService, UserRepository],
})
export class UsersModule {}
```

- [ ] **Step 10: Run to verify it passes**

Run: `pnpm test -- users.service`
Expected: PASS, 4 tests.

- [ ] **Step 11: Commit**

```bash
git add backend/src/auth/password.util.ts backend/src/auth/password.util.spec.ts \
  backend/src/users/
git commit -m "feat(backend): users repository + service + password util"
```

---

### Task 3: Account CLI (reuses UsersService via a Nest application context)

**Files:**
- Create: `backend/scripts/user.ts`

**Interfaces:**
- Consumes: `UsersService` (Task 2), `AppModule` (Task 1).
- Produces: CLI commands `pnpm run user -- create <username> <password>`, `... reset <username> <newPassword>`, `... delete <username>`, `... list`.

- [ ] **Step 1: Create `backend/scripts/user.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { Command } from 'commander';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';

async function withUsers<T>(
  fn: (users: UsersService) => Promise<T>,
): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    await fn(app.get(UsersService));
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

const program = new Command();
program.name('user').description('Manage MC panel accounts');

program
  .command('create')
  .argument('<username>')
  .argument('<password>')
  .action(async (username: string, password: string) => {
    await withUsers(async (users) => {
      await users.createUser(username, password);
      console.log(`Created user "${username}".`);
    });
  });

program
  .command('reset')
  .argument('<username>')
  .argument('<newPassword>')
  .action(async (username: string, newPassword: string) => {
    await withUsers(async (users) => {
      await users.resetPassword(username, newPassword);
      console.log(`Reset password for "${username}".`);
    });
  });

program
  .command('delete')
  .argument('<username>')
  .action(async (username: string) => {
    await withUsers(async (users) => {
      await users.deleteUser(username);
      console.log(`Deleted user "${username}".`);
    });
  });

program
  .command('list')
  .action(async () => {
    await withUsers(async (users) => {
      const list = await users.listUsers();
      if (list.length === 0) {
        console.log('No users.');
        return;
      }
      for (const u of list) {
        console.log(`${u.username}\t${u.createdAt.toISOString()}`);
      }
    });
  });

void program.parseAsync();
```

- [ ] **Step 2: Manually verify the CLI end-to-end**

Run (from `backend/`, with `.env` present):
```bash
pnpm run user -- create alice s3cret
pnpm run user -- list
pnpm run user -- create alice again   # expect "already exists", exit code 1
pnpm run user -- reset alice newpass
pnpm run user -- delete alice
pnpm run user -- list                 # expect "No users."
```
Expected: create prints success; duplicate prints "already exists" and exits non-zero; reset/delete succeed; final list prints "No users.".

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/user.ts
git commit -m "feat(backend): account CLI reusing UsersService via app context"
```

---

### Task 4: Login endpoint issuing JWT in an httpOnly cookie

**Files:**
- Create: `backend/src/auth/auth.service.ts`
- Create: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/dto/login.dto.ts`
- Create: `backend/src/auth/auth.module.ts`
- Modify: `backend/src/app.module.ts` (register `AuthModule`)
- Test: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `UsersService.validateCredentials` (Task 2), `PrismaService` (Task 1).
- Produces:
  - `POST /auth/login` body `{ username: string, password: string }` → on success sets httpOnly cookie `mcp_token` (JWT payload `{ sub: userId, username }`) and returns `{ username }`; on failure `401`.
  - `POST /auth/logout` → clears `mcp_token`, returns `{ ok: true }`.
  - `AuthService.signToken(user: { id: number; username: string }): string`.
  - JWT payload type `JwtPayload = { sub: number; username: string }` (consumed by Task 5's guard).

- [ ] **Step 1: Create `backend/src/auth/dto/login.dto.ts`**

```typescript
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
```

- [ ] **Step 2: Create `backend/src/auth/auth.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

export interface JwtPayload {
  sub: number;
  username: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  validateCredentials(
    username: string,
    password: string,
  ): Promise<{ id: number; username: string } | null> {
    return this.users.validateCredentials(username, password);
  }

  signToken(user: { id: number; username: string }): string {
    const payload: JwtPayload = { sub: user.id, username: user.username };
    return this.jwt.sign(payload);
  }
}
```

- [ ] **Step 3: Create `backend/src/auth/auth.controller.ts`**

```typescript
import {
  Body,
  Controller,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

const COOKIE_NAME = 'mcp_token';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ username: string }> {
    const user = await this.auth.validateCredentials(dto.username, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    res.cookie(COOKIE_NAME, this.auth.signToken(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
    return { username: user.username };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  }
}
```

- [ ] **Step 4: Create `backend/src/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    UsersModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 5: Register `AuthModule` in `backend/src/app.module.ts`**

Replace file contents with:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Write the e2e test `backend/test/auth.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password.util';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { username: 'e2euser' } });
    await prisma.user.create({
      data: { username: 'e2euser', passwordHash: await hashPassword('pw123') },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: 'e2euser' } });
    await app.close();
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'e2euser', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('accepts correct password and sets an httpOnly cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'e2euser', password: 'pw123' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ username: 'e2euser' });
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('mcp_token='))).toBe(true);
    expect(cookies.some((c) => /httponly/i.test(c))).toBe(true);
  });
});
```

- [ ] **Step 7: Run the test**

Run: `pnpm run test:e2e -- auth`
Expected: PASS, 2 tests.

- [ ] **Step 8: Commit**

```bash
git add backend/src/auth backend/src/app.module.ts backend/test/auth.e2e-spec.ts
git commit -m "feat(backend): login endpoint issuing JWT httpOnly cookie"
```

---

### Task 5: JwtAuthGuard + CurrentUser decorator + guarded /auth/me

**Files:**
- Create: `backend/src/auth/jwt-auth.guard.ts`
- Create: `backend/src/auth/current-user.decorator.ts`
- Modify: `backend/src/auth/auth.controller.ts` (add `GET /auth/me`)
- Test: `backend/test/me.e2e-spec.ts`

**Interfaces:**
- Consumes: `JwtPayload`, `JwtService` (Task 4), cookie `mcp_token`.
- Produces:
  - `JwtAuthGuard` — reads `mcp_token`, verifies it, sets `req.user = JwtPayload`; else `401`.
  - `@CurrentUser()` param decorator returning `JwtPayload`.
  - `GET /auth/me` (guarded) → `{ username }`.

- [ ] **Step 1: Create `backend/src/auth/jwt-auth.guard.ts`**

```typescript
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtPayload } from './auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.['mcp_token'];
    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      (req as Request & { user: JwtPayload }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
```

- [ ] **Step 2: Create `backend/src/auth/current-user.decorator.ts`**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload } from './auth.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    return req.user;
  },
);
```

- [ ] **Step 3: Add guarded `GET /auth/me` to `backend/src/auth/auth.controller.ts`**

Add to the import block at the top:
```typescript
import { Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { JwtPayload } from './auth.service';
```

Add this method inside `AuthController`:
```typescript
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload): { username: string } {
    return { username: user.username };
  }
```

- [ ] **Step 4: Write the e2e test `backend/test/me.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password.util';

describe('GET /auth/me (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { username: 'meuser' } });
    await prisma.user.create({
      data: { username: 'meuser', passwordHash: await hashPassword('pw123') },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: 'meuser' } });
    await app.close();
  });

  it('returns 401 without a cookie', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns username with a valid cookie', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ username: 'meuser', password: 'pw123' });
    const res = await agent.get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'meuser' });
  });
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm run test:e2e -- me`
Expected: PASS, 2 tests.

- [ ] **Step 6: Run the full suite**

Run: `pnpm test && pnpm run test:e2e`
Expected: all unit + e2e tests green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth/jwt-auth.guard.ts backend/src/auth/current-user.decorator.ts \
  backend/src/auth/auth.controller.ts backend/test/me.e2e-spec.ts
git commit -m "feat(backend): JwtAuthGuard, CurrentUser decorator, and /auth/me"
```

---

## Self-Review Notes

- **Spec coverage:** username/password, no email ✓ (Task 1 model, Task 4); CLI-only account creation, no HTTP signup ✓ (Task 3, and no create route anywhere); JWT httpOnly cookie ✓ (Task 4); bcrypt cost 12 ✓ (Task 2); refuse boot without required env ✓ (Task 1 `verifyEnv` in `main.ts`); SQLite ✓ (Task 1); guard for protected routes ✓ (Task 5). New requirements honored: **env-verify script** ✓ (Task 1 Step 13) and **controller→service→repository layering** ✓ (Task 2 repository/service, only `UserRepository` touches Prisma). pnpm ✓ (Global Constraints + all commands). Provisioning/console/metrics/frontend are later plans.
- **Type consistency:** `JwtPayload { sub: number; username: string }` defined in `auth.service.ts` (Task 4), reused by guard + decorator (Task 5). Cookie name `mcp_token` consistent across controller, guard, tests. `validateCredentials` signature identical between `UsersService` (Task 2), `AuthService` (Task 4). `UserRecord` shape consistent between repository and service tests.
- **Stack guard:** TS 5.9 / Prisma 6 / Nest 11 / CommonJS pinned in Global Constraints, with the rationale from the spike recorded so no one "upgrades" back into the TS7/Prisma7 breakage.
- **Placeholder scan:** no TBD/TODO; all code shown in full.

---

# Repo Tooling & Agentic Docs (added mid-execution)

These tasks were requested after the auth chain and are appended to the same
branch. They convert the repo into a **pnpm workspace** (root manages
`backend/` and future `frontend/`), add lint/format/typecheck + git hooks +
`fallow` (dead-code/dupes) enforcement, and add agent-facing docs. Unlike the
TDD tasks above, these are **verification-based**: run the tool, observe the
result. Versions verified 2026-07-25: ESLint 10.8, typescript-eslint 8.65,
Prettier 3.9, Husky 9.1, lint-staged 17.2, fallow 3.9 (bins `fallow`,
`fallow-lsp`, `fallow-mcp`).

## Additional Global Constraints

- **Monorepo:** pnpm workspace rooted at the git root (`/ssd/code/mine server`),
  members `backend` and `frontend` (frontend not created yet). Single lockfile
  at root.
- **Jest:** `maxWorkers: 3` (both unit and e2e configs).
- **Pre-commit hook:** typecheck (`tsc --noEmit`) + ESLint + Prettier (via
  lint-staged on staged files). Commit blocked on failure.
- **Pre-push hook:** build + unit tests + e2e tests + `fallow` (dead-code &
  dupes). Push blocked on failure.
- Do not weaken hooks to pass (no `--no-verify` in committed scripts). If
  existing code fails lint/fallow, fix the code.

---

### Task 6: pnpm workspace root + ESLint 10 + Prettier + Jest maxWorkers

**Files:**
- Create: `package.json` (repo root)
- Create: `pnpm-workspace.yaml` (repo root)
- Create: `eslint.config.mjs` (repo root)
- Create: `.prettierrc.json` (repo root)
- Create: `.prettierignore` (repo root)
- Modify: `backend/package.json` (add `typecheck` script; drop `packageManager`/lockfile duplication — root owns it)
- Modify: `backend/jest.config.js` (add `maxWorkers: 3`)
- Modify: `backend/test/jest-e2e.json` (add `"maxWorkers": 3`)
- Delete: `backend/pnpm-lock.yaml` (replaced by root lockfile)

**Interfaces:**
- Consumes: existing `backend/` package.
- Produces: root scripts `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test`, `build` that operate across the workspace / delegate to `backend`.

- [ ] **Step 1: Create repo-root `package.json`**

```json
{
  "name": "mc-panel",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@10.28.1",
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "pnpm --filter backend typecheck",
    "test": "pnpm --filter backend test",
    "test:e2e": "pnpm --filter backend test:e2e",
    "build": "pnpm --filter backend build",
    "prepare": "husky"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "eslint": "^10.8.0",
    "eslint-config-prettier": "^9.1.0",
    "prettier": "^3.9.6",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.65.0"
  }
}
```

Note: the `prepare: husky` script is added now but `husky` is installed in Task 7; `pnpm install` will warn (not fail) about the missing `husky` binary until then. If the warning blocks install in this pnpm version, add the `prepare` script in Task 7 instead and note it.

- [ ] **Step 2: Create repo-root `pnpm-workspace.yaml`**

```yaml
packages:
  - backend
  - frontend
```

(`frontend` does not exist yet; pnpm tolerates a missing member dir with a warning. If it errors in this pnpm version, list only `backend` and add `frontend` when it's created — note which you did.)

- [ ] **Step 3: Create repo-root `eslint.config.mjs` (flat config, non-type-aware)**

```javascript
// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'backend/src/generated/**',
      'backend/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
```

Rationale: `tseslint.configs.recommended` is syntactic (no `parserOptions.project`), so it runs fast in hooks and needs no per-package tsconfig wiring. Type-aware rules can be added later.

- [ ] **Step 4: Create repo-root `.prettierrc.json`**

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 80
}
```

- [ ] **Step 5: Create repo-root `.prettierignore`**

```
**/dist/**
**/node_modules/**
backend/src/generated/**
backend/prisma/migrations/**
pnpm-lock.yaml
```

- [ ] **Step 6: Add `typecheck` to `backend/package.json` scripts**

Add to the `scripts` block: `"typecheck": "tsc --noEmit"`. Remove the `"packageManager"` field from `backend/package.json` (root owns it now). Keep everything else.

- [ ] **Step 7: Set Jest `maxWorkers: 3`**

In `backend/jest.config.js` add `maxWorkers: 3,` to the exported object.
In `backend/test/jest-e2e.json` add `"maxWorkers": 3` as a top-level key.

- [ ] **Step 8: Convert to a single root lockfile**

Run (from repo root):
```bash
rm -f backend/pnpm-lock.yaml
pnpm install
```
Expected: a single `pnpm-lock.yaml` at root; `backend/node_modules` linked from the workspace store. If pnpm reports the Prisma build script is not approved, run `pnpm approve-builds` (the `backend/package.json` `pnpm.onlyBuiltDependencies` allowlist should already cover it) and re-run.

- [ ] **Step 9: Format and lint the existing code, fixing residual issues**

Run (from repo root):
```bash
pnpm format
pnpm lint:fix
pnpm lint
```
Expected: `pnpm lint` exits 0. Fix any remaining ESLint errors the autofix could not (e.g. unused vars) by editing the code — do NOT disable rules wholesale to pass. Prettier may reformat many files; that is expected.

- [ ] **Step 10: Verify typecheck and tests still pass**

Run (from repo root):
```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```
Expected: typecheck clean; unit 19+ tests green (now with `maxWorkers: 3`); e2e 5 tests green.

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-workspace.yaml eslint.config.mjs .prettierrc.json \
  .prettierignore pnpm-lock.yaml backend/
git rm --cached backend/pnpm-lock.yaml 2>/dev/null || true
git commit -m "chore: pnpm workspace root + eslint/prettier + jest maxWorkers:3"
```

---

### Task 7: Husky v9 hooks (pre-commit + pre-push) with lint-staged and fallow

**Files:**
- Modify: `package.json` (root — add devDeps husky, lint-staged, fallow; add `fallow` script)
- Create: `.husky/pre-commit`
- Create: `.husky/pre-push`
- Create: `.lintstagedrc.json` (root)
- Create: `.fallowrc.json` (root, via `fallow init` then adjusted)

**Interfaces:**
- Consumes: root scripts from Task 6.
- Produces: a pre-commit gate (typecheck + eslint + prettier on staged) and a pre-push gate (build + tests + fallow).

- [ ] **Step 1: Install the tools (from repo root)**

```bash
pnpm add -D -w husky@^9.1.7 lint-staged@^17.2.0 fallow@^3.9.1
```
(`-w` installs to the workspace root.)

- [ ] **Step 2: Initialize Husky**

```bash
pnpm exec husky init
```
This creates `.husky/` and a sample `.husky/pre-commit`, and sets `core.hooksPath`. Because the git root IS the repo root (where the root `package.json` lives), hooks resolve correctly.

- [ ] **Step 3: Write `.lintstagedrc.json` (root)**

```json
{
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yaml,yml}": ["prettier --write"]
}
```

- [ ] **Step 4: Write `.husky/pre-commit`**

```sh
pnpm exec lint-staged
pnpm --filter backend typecheck
```
(Husky v9 hooks are plain scripts — no shebang/sourcing boilerplate required. A non-zero exit from either line aborts the commit.)

- [ ] **Step 5: Write `.husky/pre-push`**

```sh
pnpm --filter backend build
pnpm --filter backend test
pnpm --filter backend test:e2e
pnpm fallow
```

- [ ] **Step 6: Initialize fallow config and add the `fallow` script**

Run (from repo root):
```bash
pnpm exec fallow init
```
Then ensure `.fallowrc.json` sets the entry points to the backend source and ignores generated/build output. Target config (adjust to what `init` produced):
```json
{
  "entry": ["backend/src/main.ts", "backend/scripts/*.ts"],
  "ignorePatterns": [
    "**/dist/**",
    "**/node_modules/**",
    "backend/src/generated/**",
    "backend/prisma/migrations/**",
    "**/*.spec.ts",
    "**/*.e2e-spec.ts"
  ]
}
```
Add to root `package.json` scripts: `"fallow": "fallow dead-code && fallow dupes"`.

Note: `fallow dead-code` will likely flag the forward-declared-but-unused deps
(`@nestjs/jwt` etc. are used; but e.g. `class-transformer` may register as
unused, and `bcryptjs` is used). Investigate each finding: if it is genuinely
dead, remove it; if it is a false positive (used indirectly, entry not
declared), add the entry or an ignore rule with a comment. Do NOT blanket-ignore
to make it pass — the point of the gate is real findings.

- [ ] **Step 7: Verify the pre-commit hook fires and passes**

Make a trivial no-op change and commit through the hook:
```bash
echo "" >> backend/src/main.ts   # whitespace tweak
git add backend/src/main.ts
git commit -m "test: verify pre-commit hook"
```
Expected: lint-staged runs (eslint+prettier on the staged file), typecheck runs, commit succeeds. Then revert the trivial change in a follow-up if it left noise, or amend. Confirm a deliberately-broken commit is REJECTED: introduce a type error, `git add`, attempt commit, observe failure, then discard the broken change.

- [ ] **Step 8: Verify the pre-push chain runs green (without an actual remote)**

Run the pre-push script body manually (there is no git remote):
```bash
pnpm --filter backend build && pnpm --filter backend test && \
  pnpm --filter backend test:e2e && pnpm fallow
```
Expected: all four stages succeed (exit 0). Fix any fallow findings per Step 6.

- [ ] **Step 9: Commit the hook setup**

```bash
git add package.json pnpm-lock.yaml .husky .lintstagedrc.json .fallowrc.json
git commit -m "chore: husky pre-commit (typecheck+lint+format) and pre-push (build+test+fallow)"
```

---

### Task 8: AGENTS.md and agent-facing docs

**Files:**
- Create: `AGENTS.md` (repo root)
- Create: `backend/AGENTS.md` (backend-specific pointers)
- Modify: `README.md` if present, else Create: `README.md` (repo root, brief human-facing pointer to AGENTS.md)

**Interfaces:**
- Consumes: everything built so far (structure, scripts, conventions).
- Produces: durable agent onboarding docs.

- [ ] **Step 1: Create repo-root `AGENTS.md`**

Write a concise, accurate agent-onboarding doc containing (verify every command against the actual repo before writing it):
- **Project**: Minecraft server management panel. Monorepo (pnpm workspace): `backend/` (Nest 11 API), `frontend/` (Next.js — not built yet), `docs/superpowers/` (specs + plans).
- **Stack + pinned versions** and the rationale: TypeScript 5.9, Prisma 6.19, Nest 11, CommonJS. **Do not upgrade to TypeScript 7 or Prisma 7** — TS7 removed the programmatic compiler API nest-cli needs (returns in 7.1, ~Oct 2026) and Prisma 7 is ESM-only; both break this toolchain (proven in a spike, 2026-07-25).
- **Commands** (from repo root): `pnpm install`, `pnpm --filter backend start:dev`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm format`, `pnpm fallow`.
- **Architecture rule (binding):** controller → service → repository. Only repositories import/use `PrismaService`; services never touch Prisma directly.
- **Auth model:** username + password (no email); JWT in an httpOnly cookie `mcp_token`; accounts are created ONLY via the CLI (`pnpm --filter backend run user -- create <username> <password>` / `reset` / `delete` / `list`) — there is no HTTP signup route.
- **Env:** required vars `DATABASE_URL`, `JWT_SECRET`; validated by `verifyEnv()` at boot and `pnpm --filter backend run verify:env`. Never commit `.env`.
- **Git hooks:** pre-commit runs typecheck + eslint + prettier (lint-staged); pre-push runs build + tests + fallow. Do not bypass with `--no-verify`. Fix the code, not the gate.
- **fallow MCP:** the repo ships `fallow` (dead-code/dupes). Agents can use its MCP server for live analysis (see backend/AGENTS.md for the connection command).

- [ ] **Step 2: Create `backend/AGENTS.md`**

Backend-specific: module layout (`auth/`, `users/`, `prisma/`, `health/`, `config/`), the repository pattern, where migrations live, how to add a Prisma model + migrate (`pnpm --filter backend exec prisma migrate dev --name <name>`), and test conventions (unit `*.spec.ts` colocated in `src/`, e2e in `test/`, `maxWorkers: 3`).

- [ ] **Step 3: Document the fallow MCP integration**

Fetch the current integration doc (`https://docs.fallow.tools/integrations/mcp`) and record, in `backend/AGENTS.md` under a "fallow MCP" heading, the exact way to register the `fallow-mcp` server (the binary shipped by the `fallow` package) with an MCP client — the command/args and any config. If the doc cannot be fetched at implementation time, record the known binary (`fallow-mcp`, provided by the `fallow` npm package) and a TODO to fill exact client config, and flag it as DONE_WITH_CONCERNS.

- [ ] **Step 4: Create/adjust root `README.md`**

A short human-facing README: one-paragraph description, "See AGENTS.md for full development guide", and the quick-start (`pnpm install`, create an account via the CLI, `pnpm --filter backend start:dev`).

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md backend/AGENTS.md README.md
git commit -m "docs: add AGENTS.md agent-onboarding guide and fallow MCP notes"
```
