import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FilesService } from '../src/files/files.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

describe('Files routes (e2e)', () => {
  let app: INestApplication;
  const filesService = {
    list: jest
      .fn()
      .mockResolvedValue([
        { name: 'mods', type: 'dir', sizeBytes: 0, mtimeMs: 1 },
      ]),
    writeText: jest.fn().mockResolvedValue({ mtimeMs: 5 }),
    removeMany: jest.fn().mockResolvedValue([{ path: 'a', ok: true }]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FilesService)
      .useValue(filesService)
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

  it('lists a directory', async () => {
    const res = await request(app.getHttpServer())
      .get('/servers/s1/files?path=/')
      .expect(200);
    expect(res.body).toEqual([
      { name: 'mods', type: 'dir', sizeBytes: 0, mtimeMs: 1 },
    ]);
    expect(filesService.list).toHaveBeenCalledWith('s1', '/');
  });

  it('rejects a write with a missing path', async () => {
    await request(app.getHttpServer())
      .put('/servers/s1/files/content')
      .send({ content: 'x' })
      .expect(400);
  });

  it('passes mtimeMs through on write', async () => {
    await request(app.getHttpServer())
      .put('/servers/s1/files/content')
      .send({ path: 'server.properties', content: 'a=1', mtimeMs: 42 })
      .expect(200);
    expect(filesService.writeText).toHaveBeenCalledWith(
      's1',
      'server.properties',
      'a=1',
      42,
    );
  });

  it('reports bulk delete outcomes', async () => {
    const res = await request(app.getHttpServer())
      .post('/servers/s1/files/delete')
      .send({ paths: ['a'] })
      .expect(201);
    expect(res.body).toEqual([{ path: 'a', ok: true }]);
  });
});
