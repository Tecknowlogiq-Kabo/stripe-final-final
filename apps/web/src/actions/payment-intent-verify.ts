'use server';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface PaymentIntentVerificationResult {
  status: 'succeeded' | 'processing' | 'failed' | 'pending' | 'unknown';
  message: string;
  paymentIntentId?: string;
}

/**
 * Verifies a PaymentIntent status server-side after a redirect.
 * This is the authoritative check — do not trust client-side redirect_status alone.
 */
export async function verifyPaymentIntent(
  stripePaymentIntentId: string,
): Promise<PaymentIntentVerificationResult> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/payment-intents/stripe/${stripePaymentIntentId}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      },
    );

    if (!res.ok) {
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

    if (
      status === 'requires_payment_method' ||
      status === 'canceled' ||
      status === 'payment_failed'
    ) {
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
