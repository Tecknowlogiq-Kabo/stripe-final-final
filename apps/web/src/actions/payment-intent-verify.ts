'use server';

import { apiClient, ApiError } from '@/lib/api-client';

export interface PaymentIntentVerificationResult {
  status: 'succeeded' | 'processing' | 'failed' | 'pending' | 'unknown';
  message: string;
  paymentIntentId?: string;
}

function buildRedirectFallback(
  stripePaymentIntentId: string,
  redirectStatus: string | null | undefined,
): PaymentIntentVerificationResult {
  if (redirectStatus === 'succeeded') {
    return {
      status: 'succeeded',
      message:
        'Stripe returned a successful payment, but we could not refresh your session after the redirect. Check Payment History for the saved record.',
      paymentIntentId: stripePaymentIntentId,
    };
  }

  if (redirectStatus === 'processing') {
    return {
      status: 'processing',
      message:
        'Stripe returned a processing payment, but we could not refresh your session after the redirect. Check Payment History for the latest status.',
      paymentIntentId: stripePaymentIntentId,
    };
  }

  return {
    status: 'unknown',
    message:
      'We could not verify this payment because your session was not available after the Stripe redirect. Check Payment History or your email for confirmation.',
    paymentIntentId: stripePaymentIntentId,
  };
}

/**
 * Verifies a PaymentIntent status server-side after a redirect.
 * Uses the shared api-client for automatic 401→refresh→retry.
 * If the session is truly expired (refresh fails), falls back to
 * redirect_status to provide the best possible answer.
 */
export async function verifyPaymentIntent(
  stripePaymentIntentId: string,
  redirectStatus?: string | null,
): Promise<PaymentIntentVerificationResult> {
  try {
    const data = await apiClient.get<Record<string, unknown>>(
      `/payment-intents/stripe/${stripePaymentIntentId}`,
    );

    const status = data.status as string;
    const errorMessage = data.errorMessage as string | undefined;

    if (status === 'succeeded') {
      return {
        status: 'succeeded',
        message: 'Your payment has been confirmed.',
        paymentIntentId: stripePaymentIntentId,
      };
    }

    if (status === 'processing') {
      return {
        status: 'processing',
        message: 'Your payment is being processed. You will receive confirmation shortly.',
        paymentIntentId: stripePaymentIntentId,
      };
    }

    if (status === 'requires_payment_method' || status === 'canceled') {
      return {
        status: 'failed',
        message: errorMessage ?? 'Your payment could not be completed.',
        paymentIntentId: stripePaymentIntentId,
      };
    }

    return {
      status: 'pending',
      message: `Your payment status is "${status}". Please check back later or contact support.`,
      paymentIntentId: stripePaymentIntentId,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return buildRedirectFallback(stripePaymentIntentId, redirectStatus);
    }

    return {
      status: 'unknown',
      message: 'Unable to verify payment status. Please check your email for confirmation.',
      paymentIntentId: stripePaymentIntentId,
    };
  }
}
