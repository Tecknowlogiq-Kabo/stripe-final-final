import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { paymentIntentsService } from './payment-intents.service';
import type { GetCustomerPaymentIntentsParams } from './payment-intents.types';

export const paymentIntentKeys = {
  byCustomer: (params: GetCustomerPaymentIntentsParams) =>
    ['payment-intents', 'customer', params.customerId, params.page, params.limit, params.status] as const,
};

export function useCustomerPaymentIntents(params: GetCustomerPaymentIntentsParams) {
  return useQuery({
    queryKey: paymentIntentKeys.byCustomer(params),
    queryFn:  () => paymentIntentsService.listByCustomer(params),
    enabled:  !!params.customerId,
    placeholderData: keepPreviousData, // keep previous data while fetching next page
  });
}
