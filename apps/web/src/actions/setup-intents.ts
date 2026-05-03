'use server';

import { v4 as uuidv4 } from 'uuid';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface CreateSetupIntentInput {
  customerId: string;
  paymentMethodTypes?: string[];
}

interface SetupIntentResult {
  id: string;
  clientSecret: string;
  stripeSetupIntentId: string;
  status: string;
}

export async function createSetupIntent(
  input: CreateSetupIntentInput,
): Promise<SetupIntentResult> {
  const idempotencyKey = uuidv4();

  const response = await fetch(`${API_URL}/api/v1/setup-intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to create setup' }));
    throw new Error(error.message ?? 'Failed to create setup intent');
  }

  return response.json() as Promise<SetupIntentResult>;
}
