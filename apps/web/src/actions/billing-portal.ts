'use server';

import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getAuthHeader(): Record<string, string> {
  const token = cookies().get('auth_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function createBillingPortalSession(input: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/api/v1/customers/${input.customerId}/billing-portal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ returnUrl: input.returnUrl }),
        cache: 'no-store',
      },
    );
  } catch {
    throw new Error('Unable to reach the payment service. Please check your connection and try again.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? 'Failed to create billing portal session');
  }

  return response.json() as Promise<{ url: string }>;
}
