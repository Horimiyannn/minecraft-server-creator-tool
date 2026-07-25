# Backend Foundation + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Nest.js backend with SQLite persistence and username/password auth (JWT in an httpOnly cookie), where accounts are created only by a server-side CLI script.

**Architecture:** A Nest.js application backed by Prisma + SQLite. A `User` table stores username + bcrypt hash. A standalone CLI script (not an HTTP route) manages accounts. Login issues a JWT set as an httpOnly cookie; a global-capable `JwtAuthGuard` protects routes by reading that cookie.

**Tech Stack:** Node 20+, Nest.js 10, Prisma 5 + SQLite, `@nestjs/jwt`, `bcryptjs`, `cookie-parser`, `commander` (CLI), Jest + supertest (tests).

## Global Constraints

- Single Ubuntu host; SQLite for v1 (file at `prisma/dev.db`, path configurable via `DATABASE_URL`).
- No self-service signup and **no HTTP route that creates users**. Accounts come only from the CLI script.
- Auth: username + password only (no email). JWT stored in an **httpOnly** cookie named `mcp_token`.
- Passwords hashed with `bcryptjs` (pure-JS, no native build). Cost factor 12.
- `JWT_SECRET` read from environment; app must refuse to boot if it is unset.
- Node 20+.

---

### Task 1: Scaffold Nest app with Prisma, SQLite, config, and health check

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/nest-cli.json`
- Create: `backend/.env.example`
- Create: `backend/.env`
- Create: `backend/prisma/schema.prisma`
- Create: `backend/src/main.ts`
- Create: `backend/src/app.module.ts`
- Create: `backend/src/prisma/prisma.service.ts`
- Create: `backend/src/prisma/prisma.module.ts`
- Create: `backend/src/health/health.controller.ts`
- Test: `backend/test/health.e2e-spec.ts`
- Create: `backend/test/jest-e2e.json`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `PrismaService` — a Nest injectable extending `PrismaClient`, connects on module init.
  - `PrismaModule` — global module exporting `PrismaService`.
  - Prisma `User` model: `{ id: Int @id @default(autoincrement()), username: String @unique, passwordHash: String, createdAt: DateTime @default(now()) }`.
  - Booted Nest app with `cookie-parser` enabled and a `GET /health` route returning `{ status: 'ok' }`.

- [ ] **Step 1: Create `backend/package.json`**

```json
{
  "name": "mc-panel-backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "user": "ts-node scripts/user.ts"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/config": "^3.1.1",
    "@nestjs/core": "^10.3.0",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/platform-express": "^10.3.0",
    "@prisma/client": "^5.9.0",
    "bcryptjs": "^2.4.3",
    "commander": "^11.1.0",
    "cookie-parser": "^1.4.6",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.3.0",
    "@nestjs/testing": "^10.3.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/cookie-parser": "^1.4.6",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.11",
    "@types/node": "^20.11.0",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "prisma": "^5.9.0",
    "supertest": "^6.3.4",
    "ts-jest": "^29.1.1",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

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
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Create `backend/nest-cli.json`**

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

- [ ] **Step 4: Create `backend/.env.example` and `backend/.env`**

Both files, same contents (the real `.env` is git-ignored):

```
DATABASE_URL="file:./dev.db"
JWT_SECRET="change-me-to-a-long-random-string"
NODE_ENV="development"
```

- [ ] **Step 5: Create `backend/prisma/schema.prisma`**

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

- [ ] **Step 6: Install deps and run the first migration**

Run (from `backend/`):
```bash
npm install
npx prisma migrate dev --name init
```
Expected: `prisma/migrations/*_init/migration.sql` created; `dev.db` created; `@prisma/client` generated with no errors.

- [ ] **Step 7: Create `backend/src/prisma/prisma.service.ts`**

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

- [ ] **Step 8: Create `backend/src/prisma/prisma.module.ts`**

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

- [ ] **Step 9: Create `backend/src/health/health.controller.ts`**

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

- [ ] **Step 10: Create `backend/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 11: Create `backend/src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set; refusing to start.');
  }
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
}
void bootstrap();
```

- [ ] **Step 12: Create `backend/test/jest-e2e.json`**

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" }
}
```

- [ ] **Step 13: Write the failing e2e test `backend/test/health.e2e-spec.ts`**

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

- [ ] **Step 14: Run the test to verify it passes**

Run (from `backend/`, with `JWT_SECRET` present in `.env`; the test loads `AppModule` which imports `ConfigModule`):
```bash
JWT_SECRET=test-secret npm run test:e2e -- health
```
Expected: PASS, 1 test.

- [ ] **Step 15: Create `backend/.gitignore` and commit**

Create `backend/.gitignore`:
```
node_modules/
dist/
.env
prisma/dev.db
prisma/dev.db-journal
*.log
```

Then:
```bash
git add backend/package.json backend/tsconfig.json backend/nest-cli.json \
  backend/.env.example backend/.gitignore backend/prisma/schema.prisma \
  backend/prisma/migrations backend/src backend/test
git commit -m "feat(backend): scaffold Nest + Prisma + SQLite with health check"
```

---

### Task 2: User account CLI script (create / reset-password / delete / list)

**Files:**
- Create: `backend/src/auth/password.util.ts`
- Create: `backend/scripts/user.ts`
- Test: `backend/test/password.util.spec.ts`
- Create: `backend/jest.config.js`

**Interfaces:**
- Consumes: Prisma `User` model (Task 1).
- Produces:
  - `hashPassword(plain: string): Promise<string>` and `verifyPassword(plain: string, hash: string): Promise<boolean>` in `password.util.ts` (used by Task 3).
  - CLI: `npm run user -- create <username> <password>`, `... reset <username> <newPassword>`, `... delete <username>`, `... list`.

- [ ] **Step 1: Create `backend/jest.config.js` for unit tests**

```javascript
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};
```

Note: this points `rootDir` at `src`, so the unit test lives beside the code it tests. Move the test file accordingly in Step 2.

- [ ] **Step 2: Write the failing unit test `backend/src/auth/password.util.spec.ts`**

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

- [ ] **Step 3: Run the test to verify it fails**

Run (from `backend/`):
```bash
npm test -- password.util
```
Expected: FAIL — cannot find module `./password.util`.

- [ ] **Step 4: Create `backend/src/auth/password.util.ts`**

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

- [ ] **Step 5: Run the test to verify it passes**

Run (from `backend/`):
```bash
npm test -- password.util
```
Expected: PASS, 2 tests.

- [ ] **Step 6: Create the CLI `backend/scripts/user.ts`**

```typescript
import { PrismaClient } from '@prisma/client';
import { Command } from 'commander';
import { hashPassword } from '../src/auth/password.util';

const prisma = new PrismaClient();
const program = new Command();

program.name('user').description('Manage MC panel accounts');

program
  .command('create')
  .argument('<username>')
  .argument('<password>')
  .action(async (username: string, password: string) => {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      console.error(`User "${username}" already exists.`);
      process.exitCode = 1;
      return;
    }
    await prisma.user.create({
      data: { username, passwordHash: await hashPassword(password) },
    });
    console.log(`Created user "${username}".`);
  });

program
  .command('reset')
  .argument('<username>')
  .argument('<newPassword>')
  .action(async (username: string, newPassword: string) => {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      console.error(`User "${username}" not found.`);
      process.exitCode = 1;
      return;
    }
    await prisma.user.update({
      where: { username },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    console.log(`Reset password for "${username}".`);
  });

program
  .command('delete')
  .argument('<username>')
  .action(async (username: string) => {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      console.error(`User "${username}" not found.`);
      process.exitCode = 1;
      return;
    }
    await prisma.user.delete({ where: { username } });
    console.log(`Deleted user "${username}".`);
  });

program
  .command('list')
  .action(async () => {
    const users = await prisma.user.findMany({
      select: { username: true, createdAt: true },
      orderBy: { username: 'asc' },
    });
    if (users.length === 0) {
      console.log('No users.');
      return;
    }
    for (const u of users) {
      console.log(`${u.username}\t${u.createdAt.toISOString()}`);
    }
  });

program
  .parseAsync()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 7: Manually verify the CLI end-to-end**

Run (from `backend/`):
```bash
npm run user -- create alice s3cret
npm run user -- list
npm run user -- create alice again   # expect duplicate error, exit code 1
npm run user -- reset alice newpass
npm run user -- delete alice
npm run user -- list                 # expect "No users."
```
Expected: create prints "Created user \"alice\".", duplicate prints error and exits non-zero, reset/delete succeed, final list prints "No users.".

- [ ] **Step 8: Commit**

```bash
git add backend/jest.config.js backend/src/auth/password.util.ts \
  backend/src/auth/password.util.spec.ts backend/scripts/user.ts
git commit -m "feat(backend): user account CLI and password hashing util"
```

---

### Task 3: Login endpoint issuing JWT in an httpOnly cookie

**Files:**
- Create: `backend/src/auth/auth.service.ts`
- Create: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/dto/login.dto.ts`
- Create: `backend/src/auth/auth.module.ts`
- Modify: `backend/src/app.module.ts` (register `AuthModule`)
- Test: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `verifyPassword` (Task 2), `PrismaService` (Task 1).
- Produces:
  - `POST /auth/login` with body `{ username: string, password: string }`. On success: sets httpOnly cookie `mcp_token` (a JWT whose payload is `{ sub: userId, username }`) and returns `{ username }`. On failure: `401`.
  - `POST /auth/logout`: clears the `mcp_token` cookie, returns `{ ok: true }`.
  - `AuthService.validateUser(username, password): Promise<{ id, username } | null>`.
  - JWT payload type `{ sub: number; username: string }` (consumed by Task 4's guard).

- [ ] **Step 1: Create the DTO `backend/src/auth/dto/login.dto.ts`**

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

Note: `class-validator` and `class-transformer` are required by Nest's `ValidationPipe`. Add them:
```bash
npm install class-validator class-transformer
```

- [ ] **Step 2: Create `backend/src/auth/auth.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password.util';

export interface JwtPayload {
  sub: number;
  username: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async validateUser(
    username: string,
    password: string,
  ): Promise<{ id: number; username: string } | null> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) return null;
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return null;
    return { id: user.id, username: user.username };
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
    const user = await this.auth.validateUser(dto.username, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const token = this.auth.signToken(user);
    res.cookie(COOKIE_NAME, token, {
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
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [
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

Replace the file contents with:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 6: Write the failing e2e test `backend/test/auth.e2e-spec.ts`**

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

  it('accepts correct password and sets httpOnly cookie', async () => {
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

- [ ] **Step 7: Run the test to verify it passes**

Run (from `backend/`):
```bash
JWT_SECRET=test-secret npm run test:e2e -- auth
```
Expected: PASS, 2 tests. (Requires the DB migrated from Task 1.)

- [ ] **Step 8: Commit**

```bash
git add backend/src/auth backend/src/app.module.ts backend/test/auth.e2e-spec.ts \
  backend/package.json backend/package-lock.json
git commit -m "feat(backend): login endpoint issuing JWT httpOnly cookie"
```

---

### Task 4: JwtAuthGuard protecting routes, with a /auth/me route

**Files:**
- Create: `backend/src/auth/jwt-auth.guard.ts`
- Create: `backend/src/auth/current-user.decorator.ts`
- Modify: `backend/src/auth/auth.controller.ts` (add `GET /auth/me`)
- Test: `backend/test/me.e2e-spec.ts`

**Interfaces:**
- Consumes: `JwtPayload` and `AuthService` / `JwtService` (Task 3), cookie `mcp_token`.
- Produces:
  - `JwtAuthGuard` — a Nest `CanActivate` that reads `mcp_token` from the request cookie, verifies it, and attaches `req.user = { sub, username }`; throws `401` otherwise.
  - `@CurrentUser()` param decorator returning `req.user` typed as `JwtPayload`.
  - `GET /auth/me` (guarded) returning `{ username }`.

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

- [ ] **Step 3: Add the guarded `GET /auth/me` to `backend/src/auth/auth.controller.ts`**

Add these imports at the top (merge with existing import block):
```typescript
import { Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { JwtPayload } from './auth.service';
```

Add this method inside the `AuthController` class:
```typescript
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload): { username: string } {
    return { username: user.username };
  }
```

- [ ] **Step 4: Write the failing e2e test `backend/test/me.e2e-spec.ts`**

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

- [ ] **Step 5: Run the test to verify it passes**

Run (from `backend/`):
```bash
JWT_SECRET=test-secret npm run test:e2e -- me
```
Expected: PASS, 2 tests.

- [ ] **Step 6: Run the full test suite**

Run (from `backend/`):
```bash
JWT_SECRET=test-secret npm test && JWT_SECRET=test-secret npm run test:e2e
```
Expected: all unit and e2e tests green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth/jwt-auth.guard.ts backend/src/auth/current-user.decorator.ts \
  backend/src/auth/auth.controller.ts backend/test/me.e2e-spec.ts
git commit -m "feat(backend): JwtAuthGuard, CurrentUser decorator, and /auth/me"
```

---

## Self-Review Notes

- **Spec coverage:** username/password (no email) ✓ Task 1 model + Task 3; CLI-only account creation, no HTTP signup ✓ Task 2; JWT httpOnly cookie ✓ Task 3; bcrypt cost 12 ✓ Task 2; refuse boot without `JWT_SECRET` ✓ Task 1 `main.ts`; SQLite ✓ Task 1; guard for protected routes ✓ Task 4. Provisioning/console/metrics/frontend are later plans, intentionally excluded.
- **Type consistency:** `JwtPayload { sub: number; username: string }` defined in `auth.service.ts` (Task 3), reused by guard and decorator (Task 4). Cookie name `mcp_token` consistent across controller, guard, and tests. `verifyPassword`/`hashPassword` signatures consistent between Task 2 definition and Task 3 usage.
- **Placeholder scan:** no TBD/TODO; all code shown in full.
