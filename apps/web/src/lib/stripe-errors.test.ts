import type { StripeError, PaymentIntent, SetupIntent } from '@stripe/stripe-js';
import {
  mapStripeError,
  mapPaymentIntentStatus,
  mapSetupIntentStatus,
  type MappedStripeError,
} from './stripe-errors';

// Helper to build a minimal StripeError. The Stripe types are wide; we cast
// from a structurally compatible object so tests don't need every field.
function makeError(overrides: Partial<StripeError> & Record<string, unknown>): StripeError {
  return overrides as unknown as StripeError;
}

function assertShape(result: MappedStripeError | null): asserts result is MappedStripeError {
  expect(result).not.toBeNull();
  expect(typeof result!.message).toBe('string');
  expect(['recoverable', 'non-recoverable', 'retry']).toContain(result!.recoverability);
}

describe('mapStripeError', () => {
  describe('card_error', () => {
    it('maps insufficient_funds with payment-method label', () => {
      const result = mapStripeError(
        makeError({
          type: 'card_error',
          code: 'insufficient_funds',
          message: 'Your card has insufficient funds.',
          payment_method: { type: 'card' },
        }),
      );
      assertShape(result);
      expect(result.title).toBe('Insufficient funds');
      expect(result.message).toMatch(/your card/i);
      expect(result.recoverability).toBe('recoverable');
    });

    it('maps lost_card decline_code to non-recoverable', () => {
      const result = mapStripeError(
        makeError({
          type: 'card_error',
          code: 'card_declined',
          decline_code: 'lost_card',
          payment_method: { type: 'card' },
        }),
      );
      assertShape(result);
      expect(result.title).toBe('Payment method unavailable');
      expect(result.recoverability).toBe('non-recoverable');
      // Business intent: bank flagged the card — never silently retry
      expect(result.message).toMatch(/flagged by your bank/i);
    });

    it('maps card_velocity_exceeded decline_code to retry', () => {
      const result = mapStripeError(
        makeError({
          type: 'card_error',
          code: 'card_declined',
          decline_code: 'card_velocity_exceeded',
          payment_method: { type: 'card' },
        }),
      );
      assertShape(result);
      expect(result.title).toBe('Too many attempts');
      expect(result.recoverability).toBe('retry');
    });

    it('falls back to generic decline message when code is unknown', () => {
      const result = mapStripeError(
        makeError({
          type: 'card_error',
          code: 'card_declined',
          decline_code: 'unknown_decline_xyz',
          payment_method: { type: 'card' },
        }),
      );
      assertShape(result);
      expect(result.title).toBe('Payment declined');
      expect(result.recoverability).toBe('recoverable');
    });
  });

  describe('validation_error', () => {
    it('returns recoverable with provided message', () => {
      const result = mapStripeError(
        makeError({
          type: 'validation_error',
          message: 'Card number is incomplete.',
        }),
      );
      assertShape(result);
      expect(result.title).toBe('Invalid information');
      expect(result.message).toBe('Card number is incomplete.');
      expect(result.recoverability).toBe('recoverable');
    });
  });

  describe('api_connection_error', () => {
    it('returns retry recoverability', () => {
      const result = mapStripeError(
        makeError({ type: 'api_connection_error', message: 'network down' }),
      );
      assertShape(result);
      expect(result.title).toBe('Connection issue');
      expect(result.recoverability).toBe('retry');
    });
  });

  describe('rate_limit_error', () => {
    it('returns retry recoverability', () => {
      const result = mapStripeError(
        makeError({ type: 'rate_limit_error' }),
      );
      assertShape(result);
      expect(result.title).toBe('Too many attempts');
      expect(result.recoverability).toBe('retry');
    });
  });

  describe('unknown error type', () => {
    it('returns default non-recoverable mapping', () => {
      const result = mapStripeError(
        makeError({ type: 'totally_made_up' as never, message: 'something' }),
      );
      assertShape(result);
      expect(result.title).toBe('Payment failed');
      expect(result.recoverability).toBe('non-recoverable');
    });
  });
});

describe('mapPaymentIntentStatus', () => {
  it('returns null on succeeded (happy path)', () => {
    expect(mapPaymentIntentStatus('succeeded' as PaymentIntent.Status)).toBeNull();
  });

  it('maps requires_action to retry', () => {
    const result = mapPaymentIntentStatus('requires_action' as PaymentIntent.Status);
    assertShape(result);
    expect(result.title).toBe('Action required');
    expect(result.recoverability).toBe('retry');
  });

  it('maps canceled to non-recoverable', () => {
    const result = mapPaymentIntentStatus('canceled' as PaymentIntent.Status);
    assertShape(result);
    expect(result.title).toBe('Payment canceled');
    expect(result.recoverability).toBe('non-recoverable');
  });
});

describe('mapSetupIntentStatus', () => {
  it('returns null on succeeded', () => {
    expect(mapSetupIntentStatus('succeeded' as SetupIntent.Status)).toBeNull();
  });

  it('maps requires_action to retry', () => {
    const result = mapSetupIntentStatus('requires_action' as SetupIntent.Status);
    assertShape(result);
    expect(result.title).toBe('Verification required');
    expect(result.recoverability).toBe('retry');
  });
});
