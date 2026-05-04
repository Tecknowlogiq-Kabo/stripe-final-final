'use server';

import { v4 as uuidv4 } from 'uuid';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getAuthHeader(): Record<string, string> {
  const token = cookies().get('auth_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface CreatePaymentIntentInput {
  amount: number;
  currency: string;
  customerId?: string;
  metadata?: Record<string, string>;
  description?: string;
}

interface CreatePaymentIntentResult {
  id: string;
  clientSecret: string;
  stripePaymentIntentId: string;
  status: string;
}

export async function createPaymentIntent(
  input: CreatePaymentIntentInput,
): Promise<CreatePaymentIntentResult> {
  const idempotencyKey = uuidv4();

  // For demo without a customerId, we use a test customer endpoint
  // In production, resolve the authenticated user's customerId
  const body: Record<string, unknown> = {
    amount: input.amount,
    currency: input.currency,
    metadata: input.metadata,
    description: input.description,
  };

  if (input.customerId) {
    body.customerId = input.customerId;
  }

  const response = await fetch(`${API_URL}/api/v1/payment-intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      ...getAuthHeader(),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to create payment' }));
    throw new Error(error.message ?? 'Failed to create payment intent');
  }

  return response.json() as Promise<CreatePaymentIntentResult>;
}
