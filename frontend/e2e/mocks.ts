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
