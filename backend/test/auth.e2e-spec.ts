import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
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
