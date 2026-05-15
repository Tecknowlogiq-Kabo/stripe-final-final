'use server';

import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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
 * This is the authoritative check — do not trust client-side redirect_status alone.
 */
export async function verifyPaymentIntent(
  stripePaymentIntentId: string,
  redirectStatus?: string | null,
): Promise<PaymentIntentVerificationResult> {
  try {
    const jar = cookies();
    const authToken = jar.get('auth_token')?.value;
    const res = await fetch(
      `${API_URL}/api/v1/payment-intents/stripe/${stripePaymentIntentId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Cookie: `auth_token=${authToken}` } : {}),
        },
        cache: 'no-store',
      },
    );

    if (!res.ok) {
      if (res.status === 401) {
        return buildRedirectFallback(stripePaymentIntentId, redirectStatus);
      }

      return {
        status: 'unknown',
        message: 'Unable to verify payment status. Please check your email for confirmation.',
        paymentIntentId: stripePaymentIntentId,
      };
    }

    const data = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!data) {
      return {
        status: 'unknown',
        message: 'Unable to verify payment status. Please check your email for confirmation.',
        paymentIntentId: stripePaymentIntentId,
      };
    }

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
  } catch {
    return {
      status: 'unknown',
      message: 'Unable to verify payment status. Please check your email for confirmation.',
      paymentIntentId: stripePaymentIntentId,
    };
  }
}
