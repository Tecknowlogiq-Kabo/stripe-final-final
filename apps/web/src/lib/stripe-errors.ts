import type { StripeError, PaymentIntent, SetupIntent } from '@stripe/stripe-js';

export type Recoverability = 'recoverable' | 'non-recoverable' | 'retry';

export interface MappedStripeError {
  title: string;
  message: string;
  recoverability: Recoverability;
  action?: string;
}

// ── Payment method label ─────────────────────────────────────────────────────

type RichError = StripeError & {
  payment_method?: {
    type?: string;
    card?: { wallet?: { type?: string } };
  };
};

/**
 * Derive a human-readable label from the payment method attached to the error.
 * Used to generate contextually accurate messages across all payment types.
 *
 * Examples:
 *   card (no wallet)  → "your card"
 *   apple_pay wallet  → "Apple Pay"
 *   us_bank_account   → "your bank account"
 *   klarna            → "Klarna"
 */
function getPaymentMethodLabel(error: StripeError): string {
  const pm = (error as RichError).payment_method;
  if (!pm) return 'this payment method';

  // Wallet payments tokenize to type: 'card' but have a wallet subfield
  const wallet = pm.card?.wallet?.type;
  if (wallet === 'apple_pay') return 'Apple Pay';
  if (wallet === 'google_pay') return 'Google Pay';
  if (wallet === 'link') return 'Link';
  if (wallet) return wallet.replace(/_/g, ' ');

  switch (pm.type) {
    case 'card':               return 'your card';
    case 'us_bank_account':    return 'your bank account';
    case 'sepa_debit':         return 'your bank account';
    case 'bacs_debit':         return 'your bank account';
    case 'au_becs_debit':      return 'your bank account';
    case 'klarna':             return 'Klarna';
    case 'afterpay_clearpay':  return 'Afterpay';
    case 'affirm':             return 'Affirm';
    case 'ideal':              return 'iDEAL';
    case 'bancontact':         return 'Bancontact';
    case 'giropay':            return 'giropay';
    case 'sofort':             return 'Sofort';
    case 'eps':                return 'EPS';
    case 'p24':                return 'Przelewy24';
    case 'fpx':                return 'FPX';
    case 'paypal':             return 'PayPal';
    default:                   return 'this payment method';
  }
}

// ── Main mapper ──────────────────────────────────────────────────────────────

/**
 * Map raw Stripe SDK errors to user-friendly, actionable messages.
 *
 * Stripe error types:
 *   card_error           — decline, expired, insufficient funds, CVC failure, fraud
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
    message: error.message ?? 'Something went wrong while processing your payment.',
    recoverability: 'non-recoverable',
    action: 'Please try again later or contact support.',
  };

  switch (error.type) {
    case 'card_error': {
      const e = error as StripeError & { code?: string; decline_code?: string };
      return mapDeclineError(e.code, e.decline_code, getPaymentMethodLabel(error), error.message);
    }

    case 'validation_error':
      return {
        title: 'Invalid information',
        message: error.message ?? 'Please check your payment details and try again.',
        recoverability: 'recoverable',
        action: 'Review the highlighted fields and fix any errors.',
      };

    case 'api_connection_error':
      return {
        title: 'Connection issue',
        message: 'We are having trouble connecting to our payment provider. Please check your internet connection.',
        recoverability: 'retry',
        action: 'Check your connection and try again.',
      };

    case 'api_error':
      return {
        title: 'Payment service error',
        message: 'Our payment provider is experiencing issues. No charge was made.',
        recoverability: 'retry',
        action: 'Please wait a moment and try again.',
      };

    case 'rate_limit_error':
      return {
        title: 'Too many attempts',
        message: 'You have made too many payment attempts in a short time.',
        recoverability: 'retry',
        action: 'Please wait a minute and try again.',
      };

    case 'idempotency_error':
      return {
        title: 'Duplicate request',
        message: 'This payment looks like a duplicate. No charge was made.',
        recoverability: 'retry',
        action: 'Please try again.',
      };

    case 'invalid_request_error': {
      const irCode = (error as StripeError & { code?: string }).code;
      const msg = error.message ?? '';

      // BNPL — customer declined or failed credit check (Klarna, Afterpay, Affirm)
      if (irCode === 'payment_method_customer_decline') {
        return {
          title: 'Payment declined',
          message: 'Your application for this payment method was declined. No charge was made.',
          recoverability: 'recoverable',
          action: 'Try a different payment method.',
        };
      }

      // BNPL amount limits
      if (irCode === 'amount_too_large') {
        return {
          title: 'Amount exceeds limit',
          message: 'The amount exceeds the maximum allowed for this payment method.',
          recoverability: 'recoverable',
          action: 'Try a different payment method.',
        };
      }
      if (irCode === 'amount_too_small') {
        return {
          title: 'Amount too small',
          message: 'The amount is below the minimum required for this payment method.',
          recoverability: 'recoverable',
          action: 'Try a different payment method.',
        };
      }

      // Payment method not available for this region, currency, or merchant configuration
      if (irCode === 'payment_method_not_available') {
        return {
          title: 'Payment method unavailable',
          message: 'This payment method is not available for this transaction.',
          recoverability: 'recoverable',
          action: 'Select a different payment method and try again.',
        };
      }

      const isSecretConsumed =
        msg.includes('client_secret') &&
        (msg.includes('already been used') || msg.includes('expired'));

      return {
        title: isSecretConsumed ? 'Session expired' : 'Invalid request',
        message: isSecretConsumed
          ? 'Your checkout session has expired or already been used. Please start a new checkout.'
          : 'Something went wrong setting up the payment. No charge was made.',
        recoverability: isSecretConsumed ? 'non-recoverable' : 'retry',
        action: isSecretConsumed
          ? 'Refresh the page to start a new checkout.'
          : 'Please try again.',
      };
    }

    case 'authentication_error':
      return {
        title: 'Payment configuration error',
        message: 'There is a configuration problem with our payment system. No charge was made.',
        recoverability: 'non-recoverable',
        action: 'Please contact support.',
      };

    default: {
      // Apple Pay / Google Pay / Link — user dismissed the payment sheet.
      // Stripe emits type: 'abort' which is not in the typed union but appears at runtime.
      if ((error as { type?: string }).type === 'abort') {
        return {
          title: 'Payment cancelled',
          message: 'You cancelled the payment. No charge was made.',
          recoverability: 'recoverable',
          action: 'Select a payment method to try again.',
        };
      }
      return defaultError;
    }
  }
}

// ── Decline error mapper ─────────────────────────────────────────────────────

/**
 * Map card_error codes to user-friendly messages.
 *
 * pmLabel — human-readable label from getPaymentMethodLabel:
 *   "your card", "Apple Pay", "Google Pay", "your bank account", etc.
 */
function mapDeclineError(
  code: string | undefined,
  declineCode: string | undefined,
  pmLabel: string,
  message: string | undefined,
): MappedStripeError {
  const base: MappedStripeError = {
    title: 'Payment declined',
    message: message ?? `${pmLabel} was declined. Please try a different payment method.`,
    recoverability: 'recoverable',
    action: 'Try another payment method or contact your bank.',
  };

  switch (code) {
    case 'card_declined': {
      if (declineCode === 'lost_card' || declineCode === 'stolen_card' || declineCode === 'pickup_card') {
        return {
          title: 'Payment method unavailable',
          message: `${pmLabel} has been flagged by your bank. No charge was made.`,
          recoverability: 'non-recoverable',
          action: 'Use a different payment method or contact your bank.',
        };
      }
      if (declineCode === 'card_velocity_exceeded') {
        return {
          ...base,
          title: 'Too many attempts',
          message: `You have exceeded the number of attempts allowed on ${pmLabel}.`,
          recoverability: 'retry',
          action: 'Wait a few minutes and try again, or use a different payment method.',
        };
      }
      if (declineCode === 'transaction_not_allowed' || declineCode === 'restricted_card') {
        return {
          ...base,
          title: 'Payment restricted',
          message: `${pmLabel} is not permitted for this type of transaction. No charge was made.`,
          recoverability: 'recoverable',
          action: 'Contact your bank or use a different payment method.',
        };
      }
      if (declineCode === 'do_not_honor' || declineCode === 'generic_decline') {
        return {
          ...base,
          message: 'Your bank declined the payment without providing a reason. No charge was made.',
          action: 'Contact your bank for details or use a different payment method.',
        };
      }
      return {
        ...base,
        message: 'Your bank declined the payment. No charge was made.',
      };
    }

    case 'insufficient_funds':
      return {
        ...base,
        title: 'Insufficient funds',
        message: `There are insufficient funds on ${pmLabel} for this payment.`,
        action: 'Try a different payment method.',
      };

    // These codes are card-only by definition — keep card-specific language
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
        message: `An error occurred while processing ${pmLabel}. No charge was made.`,
        recoverability: 'retry',
        action: 'Please try again in a few moments.',
      };

    case 'fraudulent':
    case 'issuer_not_available':
      return {
        ...base,
        title: 'Security block',
        message: 'Your bank has blocked this payment for security reasons. No charge was made.',
        recoverability: 'recoverable',
        action: 'Contact your bank or try a different payment method.',
      };

    case 'try_again_later':
      return {
        ...base,
        title: 'Temporary issue',
        message: 'Your bank is temporarily unable to process this payment. No charge was made.',
        recoverability: 'retry',
        action: 'Please wait a moment and try again.',
      };

    case 'authentication_required':
      return {
        ...base,
        title: 'Authentication required',
        message: 'Your bank requires additional verification for this payment. No charge was made.',
        recoverability: 'retry',
        action: 'Please try again and complete any prompts from your bank.',
      };

    default:
      return base;
  }
}

// ── Intent status mappers ────────────────────────────────────────────────────

/**
 * Map PaymentIntent statuses to user-friendly outcomes.
 * Returns null on success (caller handles the happy path).
 */
export function mapPaymentIntentStatus(
  status: PaymentIntent.Status,
): MappedStripeError | null {
  switch (status) {
    case 'succeeded':
      return null;

    case 'processing':
      return {
        title: 'Processing',
        message: 'Your payment is being processed. You will receive confirmation shortly.',
        recoverability: 'non-recoverable',
        action: 'No further action needed.',
      };

    case 'requires_payment_method':
      return {
        title: 'Payment method required',
        message: 'Your payment method was declined or not accepted. No charge was made.',
        recoverability: 'recoverable',
        action: 'Please try a different payment method.',
      };

    case 'requires_confirmation':
      return {
        title: 'Payment pending',
        message: 'Your payment requires additional confirmation. No charge has been made yet.',
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
      // if we still see it, the user likely closed the 3DS/bank-auth window.
      return {
        title: 'Action required',
        message: 'Your bank requires additional verification. The payment was not completed.',
        recoverability: 'retry',
        action: 'Please try again and complete the verification step.',
      };

    case 'requires_capture':
      return {
        title: 'Payment authorized',
        message: 'Your payment has been authorized and will be captured when your order ships.',
        recoverability: 'non-recoverable',
        action: 'No further action needed.',
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
 * Returns null on success.
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
        message: 'The payment method you provided was declined. Please try a different one.',
        recoverability: 'recoverable',
        action: 'Try a different payment method.',
      };

    case 'requires_action':
      return {
        title: 'Verification required',
        message: 'Your bank requires additional verification to save this payment method.',
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
        message: 'This setup requires additional confirmation. Your payment method was not saved.',
        recoverability: 'retry',
        action: 'Please try again or contact support.',
      };

    case 'processing':
      return {
        title: 'Verification in progress',
        message: 'Your payment method is being verified. This typically takes 1-3 business days for bank accounts. We will notify you when verification is complete.',
        recoverability: 'non-recoverable',
        action: 'No further action needed. Your payment method will be ready once verified.',
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
