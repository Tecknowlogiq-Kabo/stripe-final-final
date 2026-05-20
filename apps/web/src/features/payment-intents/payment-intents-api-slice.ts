import { apiSlice } from '@/lib/api-slice';
import { queryFnResult } from '@/lib/query-fn-helper';
import { paymentIntentsService } from './payment-intents.service';
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
      queryFn: (params) =>
        queryFnResult(() => paymentIntentsService.listByCustomer(params)),
      providesTags: (_result, _error, { customerId }) => [
        { type: 'PaymentIntent', id: `LIST-${customerId}` },
      ],
      // Keep previous data while fetching next page
      keepUnusedDataFor: 30,
    }),
  }),
});

export const { useCustomerPaymentIntentsQuery } = paymentIntentsApiSlice;
