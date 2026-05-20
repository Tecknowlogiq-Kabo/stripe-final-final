import { apiSlice } from '@/lib/api-slice';
import { apiClient } from '@/lib/api-client';
import type { PaymentMethod } from './payment-methods.types';

export const paymentMethodsApiSlice = apiSlice.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    customerPaymentMethods: builder.query<PaymentMethod[], string>({
      queryFn: (customerId) =>
        apiClient
          .get<{ data: PaymentMethod[] } | PaymentMethod[]>(
            `/payment-methods/customer/${customerId}`,
          )
          .then((res) => ({ data: Array.isArray(res) ? res : res.data })),
      providesTags: (_result, _error, customerId) => [
        { type: 'PaymentMethod', id: `LIST-${customerId}` },
      ],
    }),
    attachPaymentMethod: builder.mutation<
      PaymentMethod,
      { paymentMethodId: string; customerId: string }
    >({
      queryFn: ({ paymentMethodId, customerId }) =>
        apiClient
          .post<PaymentMethod>('/payment-methods/attach', { paymentMethodId, customerId })
          .then((data) => ({ data })),
      invalidatesTags: (_result, _error, { customerId }) => [
        { type: 'PaymentMethod', id: `LIST-${customerId}` },
      ],
    }),
    detachPaymentMethod: builder.mutation<
      { success: boolean },
      { id: string; customerId: string }
    >({
      queryFn: ({ id }) =>
        apiClient.delete<{ success: boolean }>(`/payment-methods/${id}/detach`).then((data) => ({ data })),
      invalidatesTags: (_result, _error, { customerId }) => [
        { type: 'PaymentMethod', id: `LIST-${customerId}` },
      ],
    }),
    setDefaultPaymentMethod: builder.mutation<
      PaymentMethod,
      { id: string; customerId: string }
    >({
      queryFn: ({ id }) =>
        apiClient.patch<PaymentMethod>(`/payment-methods/${id}/default`, {}).then((data) => ({ data })),
      invalidatesTags: (_result, _error, { customerId }) => [
        { type: 'PaymentMethod', id: `LIST-${customerId}` },
      ],
    }),
  }),
});

export const {
  useCustomerPaymentMethodsQuery,
  useAttachPaymentMethodMutation,
  useDetachPaymentMethodMutation,
  useSetDefaultPaymentMethodMutation,
} = paymentMethodsApiSlice;
