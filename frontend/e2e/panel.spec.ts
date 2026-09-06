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

test('creates a server through the wizard', async ({ page }) => {
  await page.goto('/servers/new');
  await page.getByLabel('Name').fill('created');
  await expect(page.getByLabel('Version')).toBeEnabled();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/servers\/new1$/);
});
