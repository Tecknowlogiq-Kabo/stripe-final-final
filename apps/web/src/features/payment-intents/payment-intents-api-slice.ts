import { apiSlice } from '@/lib/api-slice';
import { apiClient } from '@/lib/api-client';
import type {
  PaymentIntentListResponse,
  GetCustomerPaymentIntentsParams,
} from './payment-intents.types';

export const paymentIntentsApiSlice = apiSlice.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    customerPaymentIntents: builder.query<
      PaymentIntentListResponse,
      GetCustomerPaymentIntentsParams
    >({
      queryFn: ({ page = 1, limit = 10, status }) => {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('limit', String(limit));
        if (status) params.set('status', status);
        return apiClient
          .get<PaymentIntentListResponse>(
            `/payment-intents/mine?${params.toString()}`,
          )
          .then((data) => ({ data }));
      },
      providesTags: () => [
        { type: 'PaymentIntent', id: 'LIST-mine' },
      ],
      keepUnusedDataFor: 30,
    }),
  }),
});

export const { useCustomerPaymentIntentsQuery } = paymentIntentsApiSlice;
