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
