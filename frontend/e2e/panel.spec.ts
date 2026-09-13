import { test, expect } from '@playwright/test';
import { mockBackend } from './mocks';

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
