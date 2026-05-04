'use server';

import { v4 as uuidv4 } from 'uuid';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getAuthHeader(): Record<string, string> {
  const token = cookies().get('auth_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface CreateSetupIntentInput {
  customerId: string;
  paymentMethodTypes?: string[];
  usage?: 'off_session' | 'on_session';
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
      ...getAuthHeader(),
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
