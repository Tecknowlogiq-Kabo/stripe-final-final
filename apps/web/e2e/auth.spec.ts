import { test, expect } from '@playwright/test';

const TEST_EMAIL = `e2e+${Date.now()}@example.com`;
const TEST_PASSWORD = 'Password123!';

test.describe('Auth flows', () => {
  test('register → redirect to home', async ({ page }) => {
    await page.goto('/auth/register');
    await page.getByLabel('Email').fill(TEST_EMAIL);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page).toHaveURL('/', { timeout: 15_000 });
  });

  test('login with registered account → redirect to home', async ({ page }) => {
    // Register first so the account exists
    await page.goto('/auth/register');
    await page.getByLabel('Email').fill(TEST_EMAIL);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page).toHaveURL('/', { timeout: 15_000 });

    // Log out by navigating back (cookie cleared server-side in real flow)
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill(TEST_EMAIL);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL('/', { timeout: 15_000 });
  });

  test('login with wrong password → shows error', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.locator('p.text-red-600')).toBeVisible({ timeout: 10_000 });
  });
});
