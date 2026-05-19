'use server';

import { apiClient } from '@/lib/api-client';

export interface CreateSetupIntentInput {
  customerId: string;
  paymentMethodTypes?: string[];
  usage?: 'off_session' | 'on_session';
}

export interface SetupIntentResult {
  id: string;
  clientSecret: string;
  stripeSetupIntentId: string;
  status: string;
}

/**
 * Creates a Stripe SetupIntent via the API.
 * Uses the shared api-client for 401→refresh→retry and auto idempotency keys.
 */
export async function createSetupIntent(
  input: CreateSetupIntentInput,
): Promise<SetupIntentResult> {
  return apiClient.post<SetupIntentResult>('/setup-intents', input);
}
