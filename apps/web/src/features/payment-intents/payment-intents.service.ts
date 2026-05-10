import { apiClient } from '@/lib/api-client';
import type { PaymentIntentListResponse, GetCustomerPaymentIntentsParams } from './payment-intents.types';

class PaymentIntentsService {
  listByCustomer({ customerId, page = 1, limit = 10, status }: GetCustomerPaymentIntentsParams): Promise<PaymentIntentListResponse> {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (status) params.set('status', status);
    return apiClient.get(`/payment-intents/customer/${customerId}?${params.toString()}`);
  }
}

export const paymentIntentsService = new PaymentIntentsService();
