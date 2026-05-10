import { test, expect } from '@playwright/test';
import { StripeElementsHelper, STRIPE_TEST_CARDS } from './helpers/stripe.helpers';

// These tests require an authenticated session. The payment methods page
// shows an empty state for unauthenticated users (no customerId).

test.describe('Payment Methods page', () => {
  test('shows empty state or payment method list', async ({ page }) => {
    await page.goto('/payment-methods');
    const heading = page.getByRole('heading', { name: /payment methods/i });
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('add payment method form opens after clicking Add Payment Method', async ({ page }) => {
    await page.goto('/payment-methods');

    // Button only renders when a customerId is present (authenticated + customer exists)
    const addButton = page.getByRole('button', { name: /add payment method/i });
    const buttonCount = await addButton.count();

    if (buttonCount === 0) {
      // Unauthenticated path — confirm messaging is correct
      await expect(
        page.getByText(/payment methods are customer-specific/i),
      ).toBeVisible();
      return;
    }

    await addButton.click();

    // Setup form should appear
    await expect(
      page.getByRole('heading', { name: /add new payment method/i }),
    ).toBeVisible({ timeout: 10_000 });

    await page.waitForSelector('iframe[name^="__privateStripeFrame"]', {
      timeout: 30_000,
    });
  });

  test('save Visa card and see it appear in the list', async ({ page }) => {
    await page.goto('/payment-methods');

    const addButton = page.getByRole('button', { name: /add payment method/i });
    if (await addButton.count() === 0) {
      test.skip();
      return;
    }

    await addButton.click();

    await page.waitForSelector('iframe[name^="__privateStripeFrame"]', {
      timeout: 30_000,
    });

    const stripe = new StripeElementsHelper(page);
    await stripe.fillCard({ number: STRIPE_TEST_CARDS.visa });

    await page.getByRole('button', { name: /save/i }).click();

    // Poll until last4 shows up (backend syncs asynchronously after SetupIntent confirmation)
    await expect(async () => {
      await expect(page.getByText(/4242/)).toBeVisible();
    }).toPass({ timeout: 20_000 });
  });

  test('declined card during setup shows error', async ({ page }) => {
    await page.goto('/payment-methods');

    const addButton = page.getByRole('button', { name: /add payment method/i });
    if (await addButton.count() === 0) {
      test.skip();
      return;
    }

    await addButton.click();

    await page.waitForSelector('iframe[name^="__privateStripeFrame"]', {
      timeout: 30_000,
    });

    const stripe = new StripeElementsHelper(page);
    await stripe.fillCard({ number: STRIPE_TEST_CARDS.declined });

    await page.getByRole('button', { name: /save/i }).click();

    await expect(
      page.locator('[role="alert"]'),
    ).toBeVisible({ timeout: 15_000 });
  });
});
