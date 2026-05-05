import { baseApi } from '../baseApi';

export interface PaymentIntent {
  id: string;
  stripePaymentIntentId: string;
  amount: number;
  currency: string;
  status: string;
  description?: string;
  amountReceived?: number;
  receiptEmail?: string;
  statementDescriptor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentIntentListResponse {
  data: PaymentIntent[];
  total: number;
  page: number;
  limit: number;
}

export interface GetCustomerPaymentIntentsArgs {
  customerId: string;
  page?: number;
  limit?: number;
  status?: string;
}

export const paymentIntentsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCustomerPaymentIntents: builder.query<
      PaymentIntentListResponse,
      GetCustomerPaymentIntentsArgs
    >({
      query: ({ customerId, page = 1, limit = 10, status }) => {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('limit', String(limit));
        if (status) params.set('status', status);
        return `/payment-intents/customer/${customerId}?${params.toString()}`;
      },
      providesTags: (_result, _err, args) => [
        { type: 'PaymentIntent', id: args.customerId },
      ],
    }),
  }),
  overrideExisting: false,
});

export const { useGetCustomerPaymentIntentsQuery } = paymentIntentsApi;
