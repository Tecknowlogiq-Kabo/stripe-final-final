import type { StripeError, PaymentIntent, SetupIntent } from '@stripe/stripe-js';

export type Recoverability = 'recoverable' | 'non-recoverable' | 'retry';

export interface MappedStripeError {
  title: string;
  message: string;
  recoverability: Recoverability;
  action?: string;
}

/**
 * Map raw Stripe SDK errors to user-friendly, actionable messages.
 *
 * Stripe error types:
 *   card_error           — card declined, expired, insufficient funds, CVC failure, fraud
 *   validation_error     — missing/invalid fields, bad formatting
 *   api_error            — Stripe API internal error
 *   api_connection_error — network timeout, DNS failure
 *   idempotency_error    — reused idempotency key with different payload
 *   rate_limit_error     — too many requests
 *   authentication_error — invalid API key (dev-only, hide details from user)
 *   invalid_request_error — bad params, expired/consumed client secret
 */
export function mapStripeError(error: StripeError): MappedStripeError {
  const defaultError: MappedStripeError = {
    title: 'Payment failed',
    message:
      error.message ?? 'Something went wrong while processing your payment.',
    recoverability: 'non-recoverable',
    action: 'Please try again later or contact support.',
  };

  switch (error.type) {
    case 'card_error': {
      const code = (error as StripeError & { code?: string }).code;
      return mapCardError(code, error.message);
    }

    case 'validation_error':
      return {
        title: 'Invalid information',
        message:
          error.message ?? 'Please check your payment details and try again.',
        recoverability: 'recoverable',
        action: 'Review the highlighted fields and fix any errors.',
      };

    case 'api_connection_error':
      return {
        title: 'Connection issue',
        message:
          'We are having trouble connecting to our payment provider. Please check your internet connection.',
        recoverability: 'retry',
        action: 'Check your connection and click Pay again.',
      };

    case 'api_error':
      return {
        title: 'Payment service error',
        message:
          'Our payment provider is experiencing issues. Your card was not charged.',
        recoverability: 'retry',
        action: 'Please wait a moment and try again.',
      };

    case 'rate_limit_error':
      return {
        title: 'Too many attempts',
        message:
          'You have made too many payment attempts in a short time.',
        recoverability: 'retry',
        action: 'Please wait a minute and try again.',
      };

    case 'idempotency_error':
      return {
        title: 'Duplicate request',
        message:
          'This payment looks like a duplicate. Your card was not charged.',
        recoverability: 'retry',
        action: 'Please try again with different details.',
      };

    case 'invalid_request_error': {
      const msg = error.message ?? '';
      const isSecretConsumed =
        msg.includes('client_secret') &&
        (msg.includes('already been used') || msg.includes('expired'));

      return {
        title: isSecretConsumed ? 'Session expired' : 'Invalid request',
        message: isSecretConsumed
          ? 'Your checkout session has expired or already been used. Please start a new checkout.'
          : 'Something went wrong setting up the payment. Your card was not charged.',
        recoverability: isSecretConsumed ? 'non-recoverable' : 'retry',
        action: isSecretConsumed
          ? 'Refresh the page to start a new checkout.'
          : 'Please try again.',
      };
    }

    case 'authentication_error':
      return {
        title: 'Payment configuration error',
        message:
          'There is a configuration problem with our payment system. Your card was not charged.',
        recoverability: 'non-recoverable',
        action: 'Please contact support.',
      };

    default:
      return defaultError;
  }
}

function mapCardError(
  code: string | undefined,
  message: string | undefined,
): MappedStripeError {
  const base: MappedStripeError = {
    title: 'Card declined',
    message: message ?? 'Your card was declined. Please try a different card.',
    recoverability: 'recoverable',
    action: 'Try another payment method or contact your bank.',
  };

  switch (code) {
    case 'card_declined':
      return {
        ...base,
        title: 'Card declined',
        message:
          'Your bank declined the payment. No charge was made.',
        action: 'Try another card or contact your bank.',
      };

    case 'insufficient_funds':
      return {
        ...base,
        title: 'Insufficient funds',
        message: 'Your card does not have enough funds for this payment.',
        action: 'Try another card or a different payment method.',
      };

    case 'expired_card':
      return {
        ...base,
        title: 'Expired card',
        message: 'Your card has expired. Please use a different card.',
        action: 'Update your card details or use another card.',
      };

    case 'incorrect_cvc':
    case 'incorrect_number':
      return {
        ...base,
        title: 'Incorrect card details',
        message: 'The card details you entered are incorrect. Please double-check.',
        action: 'Review your card number, expiry, and CVC and try again.',
      };

    case 'processing_error':
      return {
        ...base,
        title: 'Processing error',
        message: 'An error occurred while processing your card. Your card was not charged.',
        recoverability: 'retry',
        action: 'Please try again in a few moments.',
      };

    case 'fraudulent':
    case 'issuer_not_available':
      return {
        ...base,
        title: 'Security block',
        message:
          'Your bank has blocked this payment for security reasons. No charge was made.',
        recoverability: 'recoverable',
        action: 'Contact your bank or try a different payment method.',
      };

    case 'try_again_later':
      return {
        ...base,
        title: 'Temporary issue',
        message:
          'Your bank is temporarily unable to process this payment. No charge was made.',
        recoverability: 'retry',
        action: 'Please wait a moment and try again.',
      };

    case 'authentication_required':
      return {
        ...base,
        title: 'Authentication required',
        message:
          'Your bank requires additional verification for this payment. No charge was made.',
        recoverability: 'retry',
        action: 'Please try again and complete any prompts from your bank.',
      };

    default:
      return base;
  }
}

/**
 * Map PaymentIntent statuses to user-friendly outcomes.
 */
export function mapPaymentIntentStatus(
  status: PaymentIntent.Status,
): MappedStripeError | null {
  switch (status) {
    case 'succeeded':
      return null; // success — no error

    case 'processing':
      return {
        title: 'Processing',
        message:
          'Your payment is being processed. You will receive confirmation shortly.',
        recoverability: 'non-recoverable',
        action: 'No further action needed.',
      };

    case 'requires_payment_method':
      return {
        title: 'Payment method required',
        message:
          'Your payment method was declined or not accepted. No charge was made.',
        recoverability: 'recoverable',
        action: 'Please try a different payment method.',
      };

    case 'requires_confirmation':
      return {
        title: 'Payment pending',
        message:
          'Your payment requires additional confirmation. No charge has been made yet.',
        recoverability: 'retry',
        action: 'Please try again or contact support.',
      };

    case 'canceled':
      return {
        title: 'Payment canceled',
        message: 'This payment has been canceled. No charge was made.',
        recoverability: 'non-recoverable',
        action: 'Start a new checkout if you still want to pay.',
      };

    case 'requires_action':
      // redirect: 'if_required' handles most of these automatically;
      // if we still see it, the user likely closed the 3DS window.
      return {
        title: 'Action required',
        message:
          'Your bank requires additional verification. The payment was not completed.',
        recoverability: 'retry',
        action: 'Please try again and complete the verification step.',
      };

    default:
      return {
        title: 'Unexpected status',
        message: `Payment ended with status "${status}". No charge was made.`,
        recoverability: 'retry',
        action: 'Please try again or contact support.',
      };
  }
}

/**
 * Map SetupIntent statuses to user-friendly outcomes.
 */
export function mapSetupIntentStatus(
  status: SetupIntent.Status,
): MappedStripeError | null {
  switch (status) {
    case 'succeeded':
      return null;

    case 'requires_payment_method':
      return {
        title: 'Payment method required',
        message:
          'The payment method you provided was declined. Please try a different one.',
        recoverability: 'recoverable',
        action: 'Try a different card or payment method.',
      };

    case 'requires_action':
      return {
        title: 'Verification required',
        message:
          'Your bank requires additional verification to save this card.',
        recoverability: 'retry',
        action: 'Please try again and complete the verification step.',
      };

    case 'canceled':
      return {
        title: 'Setup canceled',
        message: 'This setup has been canceled.',
        recoverability: 'non-recoverable',
        action: 'Start again if you want to save a payment method.',
      };

    case 'requires_confirmation':
      return {
        title: 'Setup pending',
        message:
          'This setup requires additional confirmation. Your card was not saved.',
        recoverability: 'retry',
        action: 'Please try again or contact support.',
      };

    default:
      return {
        title: 'Unexpected status',
        message: `Setup ended with status "${status}".`,
        recoverability: 'retry',
        action: 'Please try again or contact support.',
      };
  }
}
