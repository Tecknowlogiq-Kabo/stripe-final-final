'use server';

import { apiClient } from '@/lib/api-client';

export async function createBillingPortalSession(input: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  return apiClient.post<{ url: string }>(
    `/customers/${input.customerId}/billing-portal`,
    { returnUrl: input.returnUrl },
  );
}
