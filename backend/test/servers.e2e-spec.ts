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
