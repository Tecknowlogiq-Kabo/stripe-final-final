'use server';

import { v4 as uuidv4 } from 'uuid';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getAuthHeader(): Record<string, string> {
  const token = cookies().get('auth_token')?.value;
  return token ? { Cookie: `auth_token=${token}` } : {};
}

export interface CreatePaymentIntentInput {
  amount: number;
  currency: string;
  customerId?: string;
  setupFutureUsage?: 'on_session' | 'off_session';
  metadata?: Record<string, string>;
  description?: string;
}

export interface CreatePaymentIntentResult {
  id: string;
  clientSecret: string;
  stripePaymentIntentId: string;
  status: string;
}

export interface PaymentIntentError {
  message: string;
  stripeRequestId?: string;
  statusCode: number;
}

function classifyHttpError(status: number, body: Record<string, unknown>): PaymentIntentError {
  switch (status) {
    case 400:
      return {
        message: (body.message as string) ?? 'Invalid payment request. Please check your details.',
        stripeRequestId: body.stripeRequestId as string | undefined,
        statusCode: 400,
      };
    case 401:
      return {
        message: 'You are not authenticated. Please sign in and try again.',
        statusCode: 401,
      };
    case 429:
      return {
        message: 'Too many requests. Please wait a moment and try again.',
        stripeRequestId: body.stripeRequestId as string | undefined,
        statusCode: 429,
      };
    case 500:
      return {
        message: 'Our payment service is experiencing issues. Please try again later.',
        stripeRequestId: body.stripeRequestId as string | undefined,
        statusCode: 500,
      };
    case 503:
      return {
        message: 'Payment service is temporarily unavailable. Please try again shortly.',
        stripeRequestId: body.stripeRequestId as string | undefined,
        statusCode: 503,
      };
    default:
      return {
        message: (body.message as string) ?? `Payment request failed (${status}).`,
        stripeRequestId: body.stripeRequestId as string | undefined,
        statusCode: status,
      };
  }
}

export async function createPaymentIntent(
  input: CreatePaymentIntentInput,
): Promise<CreatePaymentIntentResult> {
  const idempotencyKey = uuidv4();

  const body: Record<string, unknown> = {
    amount: input.amount,
    currency: input.currency,
    setupFutureUsage: input.setupFutureUsage,
    metadata: input.metadata,
    description: input.description,
  };

  if (input.customerId) {
    body.customerId = input.customerId;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/payment-intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...getAuthHeader(),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Unable to reach the payment service. Please check your connection and try again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: 'Failed to create payment' }));
    const classified = classifyHttpError(response.status, errorBody);
    const err = new Error(classified.message);
    (err as Error & { stripeRequestId?: string }).stripeRequestId = classified.stripeRequestId;
    throw err;
  }

  return response.json() as Promise<CreatePaymentIntentResult>;
}
