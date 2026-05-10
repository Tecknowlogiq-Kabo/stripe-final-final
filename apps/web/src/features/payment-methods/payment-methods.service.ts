import { apiClient } from '@/lib/api-client';
import type { PaymentMethod } from './payment-methods.types';

class PaymentMethodsService {
  listByCustomer(customerId: string): Promise<PaymentMethod[]> {
    return apiClient
      .get<{ data: PaymentMethod[] } | PaymentMethod[]>(`/payment-methods/customer/${customerId}`)
      .then((res) => (Array.isArray(res) ? res : res.data));
  }

  attach(paymentMethodId: string, customerId: string): Promise<PaymentMethod> {
    return apiClient.post(
      '/payment-methods/attach',
      { paymentMethodId, customerId },
      { 'Idempotency-Key': crypto.randomUUID() },
    );
  }

  detach(id: string): Promise<{ success: boolean }> {
    return apiClient.delete(`/payment-methods/${id}/detach`);
  }

  setDefault(id: string): Promise<PaymentMethod> {
    return apiClient.patch(
      `/payment-methods/${id}/default`,
      {},
      { 'Idempotency-Key': crypto.randomUUID() },
    );
  }
}

export const paymentMethodsService = new PaymentMethodsService();
