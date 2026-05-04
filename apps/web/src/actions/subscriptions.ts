'use server';

import { v4 as uuidv4 } from 'uuid';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getAuthHeader(): Record<string, string> {
  const token = cookies().get('auth_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getSubscriptionPlans() {
  const response = await fetch(`${API_URL}/api/v1/subscriptions/plans`, {
    headers: getAuthHeader(),
    next: { revalidate: 3600 }, // cache for 1 hour
  });
  if (!response.ok) throw new Error('Failed to fetch plans');
  return response.json();
}

export async function createSubscription(input: {
  customerId: string;
  priceId: string;
  paymentMethodId?: string;
  trialPeriodDays?: number;
}) {
  const idempotencyKey = uuidv4();
  const response = await fetch(`${API_URL}/api/v1/subscriptions`, {
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
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? 'Failed to create subscription');
  }
  return response.json();
}

export async function cancelSubscription(id: string) {
  const response = await fetch(`${API_URL}/api/v1/subscriptions/${id}`, {
    method: 'DELETE',
    headers: getAuthHeader(),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Failed to cancel subscription');
  return response.json();
}

export async function getCustomerSubscriptions(customerId: string) {
  const response = await fetch(
    `${API_URL}/api/v1/subscriptions/customer/${customerId}`,
    {
      headers: getAuthHeader(),
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('Failed to fetch subscriptions');
  return response.json();
}
