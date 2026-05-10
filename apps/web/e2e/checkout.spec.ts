import { test, expect } from '@playwright/test';
import { StripeElementsHelper, STRIPE_TEST_CARDS } from './helpers/stripe.helpers';

// These tests require the full stack to be running and Stripe in test mode.
// The checkout page creates a real PaymentIntent server-side before rendering the iframe.

test.describe('Checkout', () => {
  test('successful payment with Visa card', async ({ page }) => {
    await page.goto('/checkout?amount=2000&currency=usd');

    await page.waitForSelector('iframe[name^="__privateStripeFrame"]', {
      timeout: 30_000,
    });

    const stripe = new StripeElementsHelper(page);
    await stripe.fillCard();

    await page.getByRole('button', { name: /pay/i }).click();

    await expect(
      page.getByText(/payment successful/i),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('declined card shows error message', async ({ page }) => {
    await page.goto('/checkout?amount=2000&currency=usd');

    await page.waitForSelector('iframe[name^="__privateStripeFrame"]', {
      timeout: 30_000,
    });

    const stripe = new StripeElementsHelper(page);
    await stripe.fillCard({ number: STRIPE_TEST_CARDS.declined });

    await page.getByRole('button', { name: /pay/i }).click();

    await expect(
      page.locator('[role="alert"]'),
    ).toContainText(/declined/i, { timeout: 20_000 });
  });

  test('submit button is disabled during processing to prevent double-submit', async ({ page }) => {
    await page.goto('/checkout?amount=2000&currency=usd');

    await page.waitForSelector('iframe[name^="__privateStripeFrame"]', {
      timeout: 30_000,
    });

    const stripe = new StripeElementsHelper(page);
    await stripe.fillCard();

    const submitButton = page.getByRole('button', { name: /pay/i });
    await submitButton.click();

    // Button should be disabled immediately after click
    await expect(submitButton).toBeDisabled();
  });
});
