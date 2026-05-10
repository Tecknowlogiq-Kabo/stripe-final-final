'use server';

import { v4 as uuidv4 } from 'uuid';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getAuthHeader(): Record<string, string> {
  const token = cookies().get('auth_token')?.value;
  return token ? { Cookie: `auth_token=${token}` } : {};
}

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

export interface SetupIntentError {
  message: string;
  stripeRequestId?: string;
  statusCode: number;
}

function classifyHttpError(status: number, body: Record<string, unknown>): SetupIntentError {
  switch (status) {
    case 400:
      return {
        message: (body.message as string) ?? 'Invalid setup request. Please check your details.',
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
        message: (body.message as string) ?? `Setup request failed (${status}).`,
        stripeRequestId: body.stripeRequestId as string | undefined,
        statusCode: status,
      };
  }
}

export async function createSetupIntent(
  input: CreateSetupIntentInput,
): Promise<SetupIntentResult> {
  const idempotencyKey = uuidv4();

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/setup-intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...getAuthHeader(),
      },
      body: JSON.stringify(input),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Unable to reach the payment service. Please check your connection and try again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: 'Failed to create setup' }));
    const classified = classifyHttpError(response.status, errorBody);
    const err = new Error(classified.message);
    (err as Error & { stripeRequestId?: string }).stripeRequestId = classified.stripeRequestId;
    throw err;
  }

  return response.json() as Promise<SetupIntentResult>;
}
