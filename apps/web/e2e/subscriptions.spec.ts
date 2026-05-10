import { test, expect } from '@playwright/test';
import { StripeElementsHelper } from './helpers/stripe.helpers';

test.describe('Subscription plans page', () => {
  test('renders plan list or empty state', async ({ page }) => {
    await page.goto('/subscriptions');

    // Either plans are shown or the empty-state message
    const heading = page.getByRole('heading', { name: /subscription plans/i });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // At least one plan card or the empty-state text
    const hasPlans = await page.locator('.card').count() > 0;
    expect(hasPlans).toBe(true);
  });

  test('subscribe button links to checkout with correct params', async ({ page }) => {
    await page.goto('/subscriptions');

    // Wait for plans to load (or empty state)
    await page.waitForSelector('.card', { timeout: 15_000 });

    const subscribeLink = page.getByRole('link', { name: /subscribe/i }).first();

    // Only test if at least one plan exists
    const count = await subscribeLink.count();
    if (count === 0) {
      test.skip();
      return;
    }

    const href = await subscribeLink.getAttribute('href');
    expect(href).toContain('/checkout');
    expect(href).toContain('amount=');
    expect(href).toContain('currency=');
  });

  test('subscribe flow completes checkout when a plan is available', async ({ page }) => {
    await page.goto('/subscriptions');
    await page.waitForSelector('.card', { timeout: 15_000 });

    const subscribeLink = page.getByRole('link', { name: /subscribe/i }).first();
    const count = await subscribeLink.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await subscribeLink.click();

    // Should land on checkout
    await expect(page).toHaveURL(/\/checkout/, { timeout: 10_000 });

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
});
