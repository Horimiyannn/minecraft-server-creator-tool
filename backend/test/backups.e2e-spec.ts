import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BackupService } from '../src/backups/backup.service';
import { BackupScheduleService } from '../src/backups/backup-schedule.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

describe('backups routes (e2e)', () => {
  let app: INestApplication;
  const backupService = {
    list: jest.fn().mockResolvedValue([
      {
        id: 'b1',
        serverId: 's1',
        kind: 'world',
        trigger: 'manual',
        label: null,
        path: '/srv/mc/s1/backups/world.tar.zst',
        sizeBytes: 1234n,
        createdAt: new Date('2026-09-12T10:00:00.000Z'),
      },
    ]),
    create: jest.fn().mockResolvedValue({
      id: 'b2',
      serverId: 's1',
      kind: 'full',
      trigger: 'manual',
      label: null,
      path: '/srv/mc/s1/backups/full.tar.zst',
      sizeBytes: 10n,
      createdAt: new Date(),
    }),
    restore: jest.fn().mockResolvedValue(undefined),
  };
  const backupScheduleService = {
    get: jest.fn().mockResolvedValue({ serverId: 's1', keepWorld: 12 }),
    save: jest.fn().mockResolvedValue({ serverId: 's1', keepWorld: 3 }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BackupService)
      .useValue(backupService)
      .overrideProvider(BackupScheduleService)
      .useValue(backupScheduleService)
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serializes sizeBytes as a JSON number', async () => {
    const res = await request(app.getHttpServer())
      .get('/servers/s1/backups')
      .expect(200);
    expect(res.body[0].sizeBytes).toBe(1234);
  });

  it('rejects an unknown backup kind', async () => {
    await request(app.getHttpServer())
      .post('/servers/s1/backups')
      .send({ kind: 'everything' })
      .expect(400);
  });

  it('rejects a keep count above 20', async () => {
    await request(app.getHttpServer())
      .put('/servers/s1/backups/schedule')
      .send({
        worldEveryMin: 60,
        fullEveryMin: null,
        keepWorld: 21,
        keepFull: 5,
        skipWhenEmpty: true,
        chatEnabled: true,
      })
      .expect(400);
  });
});
