import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { Readable } from 'node:stream';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DockerService } from '../src/servers/docker.service';
import { RconService } from '../src/console/rcon.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { hashPassword } from '../src/auth/password.util';

// A fresh fake docker log stream that pushes one line shortly after the
// gateway attaches its 'data' listener, then stays open.
function fakeLogStream(): Readable {
  const s = new Readable({ read() {} });
  setTimeout(() => s.push('Server started!\n'), 20);
  return s;
}

const fakeDocker: Partial<DockerService> = {
  create: jest.fn().mockResolvedValue('fake-container-id'),
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  restart: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  inspect: jest.fn().mockResolvedValue({ running: true, status: 'running' }),
  logs: jest.fn().mockImplementation(() => Promise.resolve(fakeLogStream())),
  dataDir: jest.fn().mockReturnValue('/tmp/does-not-exist'),
};
const fakeRcon: Partial<RconService> = {
  send: jest
    .fn()
    .mockResolvedValue('There are 0 of a max of 20 players online'),
};
const fakeMetrics: Partial<MetricsService> = {
  collect: jest.fn().mockResolvedValue({
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
    const port = typeof address === 'object' ? address!.port : address;
    url = `http://127.0.0.1:${port}`;

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
      forceNew: true, // own Manager per client (namespaces otherwise multiplex)
      extraHeaders: { Cookie: cookie },
    });
  }

  it('rejects a socket with no auth cookie', (done) => {
    const socket = io(`${url}/metrics`, {
      transports: ['websocket'],
      forceNew: true,
    });
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
