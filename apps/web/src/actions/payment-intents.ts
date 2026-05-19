'use server';

import { apiClient } from '@/lib/api-client';

export interface CreatePaymentIntentInput {
  amount: number;
  currency: string;
  customerId?: string;
  setupFutureUsage?: 'on_session' | 'off_session';
  paymentMethodTypes?: string[];
  metadata?: Record<string, string>;
  description?: string;
}

export interface CreatePaymentIntentResult {
  id: string;
  clientSecret: string;
  stripePaymentIntentId: string;
  status: string;
}

/**
 * Creates a Stripe PaymentIntent via the API.
 * Uses the shared api-client which handles:
 *   - Automatic idempotency keys (prevents double-charges)
 *   - 401 → silent token refresh → retry
 *   - Cookie forwarding on both server and client
 */
export async function createPaymentIntent(
  input: CreatePaymentIntentInput,
): Promise<CreatePaymentIntentResult> {
  const body: Record<string, unknown> = {
    amount: input.amount,
    currency: input.currency,
    setupFutureUsage: input.setupFutureUsage,
    paymentMethodTypes: input.paymentMethodTypes,
    metadata: input.metadata,
    description: input.description,
  };

  if (input.customerId) {
    body.customerId = input.customerId;
  }

  return apiClient.post<CreatePaymentIntentResult>('/payment-intents', body);
}
