import { apiClient } from '@/lib/api-client';
import type { PaymentMethod } from './payment-methods.types';

export const paymentMethodsService = {
  listByCustomer: (customerId: string): Promise<PaymentMethod[]> =>
    apiClient.get(`/payment-methods/customer/${customerId}`),

  attach: (paymentMethodId: string, customerId: string): Promise<PaymentMethod> =>
    apiClient.post(
      '/payment-methods/attach',
      { paymentMethodId, customerId },
      { 'Idempotency-Key': crypto.randomUUID() },
    ),

  detach: (id: string): Promise<{ success: boolean }> =>
    apiClient.delete(`/payment-methods/${id}/detach`),

  setDefault: (id: string): Promise<PaymentMethod> =>
    apiClient.patch(
      `/payment-methods/${id}/default`,
      {},
      { 'Idempotency-Key': crypto.randomUUID() },
    ),
};
