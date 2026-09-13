import { test, expect } from '@playwright/test';
import { mockBackend, mockFiles } from './mocks';

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test('logs in and lands on the dashboard', async ({ page }) => {
  // First /auth/me is unauthenticated so the guard shows the login route.
  await page.route('**/auth/me', (r) => r.fulfill({ status: 401, body: '' }), {
    times: 1,
  });
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('pw');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible();
  await expect(page.getByText('survival')).toBeVisible();
});

test('creates a server through the modal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New server' }).click();
  const dialog = page.getByRole('dialog', { name: 'New server' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill('created');
  await expect(dialog.getByLabel('Version')).toBeEnabled();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/servers\/new1$/);
});

test('offers a loader build once a non-vanilla loader is picked', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New server' }).click();
  const dialog = page.getByRole('dialog', { name: 'New server' });
  // Vanilla ships no loader jar, so there is nothing to pin.
  await expect(dialog.getByLabel('forge build')).toBeHidden();
  await dialog.getByLabel('Loader').selectOption('forge');
  await expect(dialog.getByLabel('forge build')).toBeEnabled();
});

test('closes the create modal with Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New server' }).click();
  const dialog = page.getByRole('dialog', { name: 'New server' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('edits a config file from the Files tab', async ({ page }) => {
  await mockFiles(page);
  const saves: unknown[] = [];
  await page.route('**/servers/s1/files/content*', (r) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    saves.push(r.request().postDataJSON());
    return r.fulfill({ json: { mtimeMs: 2 } });
  });

  await page.goto('/servers/s1');
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByRole('button', { name: 'server.properties' }).click();
  const editor = page.getByRole('textbox', { name: 'server.properties' });
  await expect(editor).toHaveValue('level-name=world');
  await editor.fill('level-name=new');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect
    .poll(() => saves)
    .toEqual([
      { path: 'server.properties', content: 'level-name=new', mtimeMs: 1 },
    ]);
});
