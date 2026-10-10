import type { Page } from '@playwright/test';

const server = {
  id: 's1',
  name: 'survival',
  loader: 'vanilla',
  version: '1.20.1',
  loaderVersion: null,
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
    r.fulfill({ json: { loader: 'vanilla', versions: ['1.20.1', '1.20.2'] } }),
  );
  // Registered last so it wins: Playwright matches routes newest-first, and
  // the glob above would otherwise swallow the builds path.
  await page.route('**/versions/*/builds/*', (r) =>
    r.fulfill({
      json: { loader: 'forge', mcVersion: '1.20.1', builds: ['47.2.0'] },
    }),
  );
}

// Detail + file-manager routes for the Files tab. Registered after
// mockBackend, so these win (Playwright matches newest-first).
export async function mockFiles(page: Page) {
  // Pinned to the API origin: a bare `**/servers/s1` glob also matches the
  // page navigation to :3000/servers/s1 and would answer it with JSON.
  await page.route('http://localhost:3001/servers/s1', (r) =>
    r.fulfill({ json: { ...server, live: null } }),
  );
  await page.route('**/servers/s1/files?path=*', (r) =>
    r.fulfill({
      json: [
        { name: 'server.properties', type: 'file', sizeBytes: 20, mtimeMs: 1 },
      ],
    }),
  );
  await page.route('**/servers/s1/files/content*', (r) =>
    r.fulfill({ json: { content: 'level-name=world', mtimeMs: 1 } }),
  );
}

const backup = {
  id: 'b1',
  serverId: 's1',
  kind: 'world',
  trigger: 'manual',
  label: null,
  sizeBytes: 3 * 1024 * 1024,
  createdAt: new Date(0).toISOString(),
};

// Backups-tab routes. Registered after mockBackend, so these win (Playwright
// matches newest-first). The schedule glob goes last for the same reason.
export async function mockBackups(page: Page) {
  await page.route('http://localhost:3001/servers/s1', (r) =>
    r.fulfill({ json: { ...server, live: null } }),
  );
  await page.route('**/servers/s1/backups', (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({ json: { ...backup, id: 'b2', kind: 'full' } })
      : r.fulfill({ json: [backup] }),
  );
  await page.route('**/servers/s1/backups/schedule', (r) =>
    r.fulfill({
      json: {
        serverId: 's1',
        worldEveryMin: 60,
        fullEveryMin: null,
        keepWorld: 12,
        keepFull: 5,
        skipWhenEmpty: true,
        chatEnabled: true,
      },
    }),
  );
}
