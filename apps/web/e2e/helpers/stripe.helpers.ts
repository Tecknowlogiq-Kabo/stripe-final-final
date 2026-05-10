import type { Page, FrameLocator } from '@playwright/test';

export const STRIPE_TEST_CARDS = {
  visa:              '4242424242424242',
  mastercard:        '5555555555554444',
  declined:          '4000000000000002',
  insufficientFunds: '4000000000009995',
  expiredCard:       '4000000000000069',
  incorrectCVC:      '4000000000000127',
  processingError:   '4000000000000119',
  require3DS:        '4000002500003155',
  fail3DS:           '4000008260003178',
} as const;

export const DEFAULT_CARD = {
  number: STRIPE_TEST_CARDS.visa,
  expiry: '1230',
  cvc:    '123',
  zip:    '10001',
} as const;

export class StripeElementsHelper {
  private frame: FrameLocator;

  constructor(private readonly page: Page) {
    this.frame = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
  }

  async waitForReady(maxAttempts = 5): Promise<void> {
    const cardInput = this.frame
      .locator('input[placeholder*="1234"]')
      .or(this.frame.getByRole('textbox', { name: /card/i }));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await cardInput.waitFor({ state: 'visible', timeout: 5_000 });
        return;
      } catch {
        await this.page.waitForTimeout(1_000 * attempt);
      }
    }

    await this.page.screenshot({ path: 'test-results/stripe-iframe-not-ready.png' });
    throw new Error(`Stripe Elements iframe did not initialize after ${maxAttempts} attempts`);
  }

  async fillCardNumber(number: string): Promise<void> {
    const input = this.frame
      .locator('input[placeholder*="1234"]')
      .or(this.frame.getByRole('textbox', { name: /card/i }));
    await input.click();
    await input.clear();
    for (const char of number) {
      await input.press(char, { delay: 30 });
    }
    await this.page.waitForTimeout(300);
  }

  async fillExpiry(mmyy: string): Promise<void> {
    const input = this.frame
      .locator('input[placeholder*="MM"]')
      .or(this.frame.getByRole('textbox', { name: /expi/i }));
    await input.waitFor({ state: 'visible', timeout: 5_000 });
    await input.click();
    await input.type(mmyy, { delay: 50 });
    await this.page.waitForTimeout(300);
  }

  async fillCVC(cvc: string): Promise<void> {
    const input = this.frame
      .locator('input[placeholder*="CVC"]')
      .or(this.frame.getByRole('textbox', { name: /security|cvc/i }));
    await input.waitFor({ state: 'visible', timeout: 5_000 });
    await input.click();
    await input.type(cvc, { delay: 50 });
    await this.page.waitForTimeout(300);
  }

  async fillZIP(zip: string): Promise<void> {
    const input = this.frame
      .locator('input[placeholder*="12345"]')
      .or(this.frame.getByRole('textbox', { name: /postal|zip/i }));
    try {
      await input.waitFor({ state: 'visible', timeout: 3_000 });
      await input.fill(zip);
      await this.page.waitForTimeout(300);
    } catch {
      // ZIP not required for all locales
    }
  }

  async fillCard(opts?: { number?: string; expiry?: string; cvc?: string; zip?: string }): Promise<void> {
    const card = { ...DEFAULT_CARD, ...opts };
    await this.waitForReady();
    await this.fillCardNumber(card.number);
    await this.fillExpiry(card.expiry);
    await this.fillCVC(card.cvc);
    if (card.zip) await this.fillZIP(card.zip);
  }
}

export async function handle3DSChallenge(
  page: Page,
  action: 'complete' | 'fail' = 'complete',
): Promise<void> {
  const challengeFrame = page.frameLocator(
    'iframe[name^="__stripeJSChallengeFrame"], iframe[name*="3ds"]',
  );
  const innerFrame = challengeFrame.frameLocator('iframe');
  const button = action === 'complete'
    ? innerFrame.getByRole('button', { name: /complete/i })
    : innerFrame.getByRole('button', { name: /fail/i });
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  await button.click();
}
