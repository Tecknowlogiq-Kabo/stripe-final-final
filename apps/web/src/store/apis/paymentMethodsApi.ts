import { baseApi } from '../baseApi';

export interface PaymentMethod {
  id: string;
  stripePaymentMethodId: string;
  type: string;
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
  createdAt: string;
}

export const paymentMethodsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCustomerPaymentMethods: builder.query<PaymentMethod[], string>({
      query: (customerId) => `/payment-methods/customer/${customerId}`,
      providesTags: (_result, _err, customerId) => [
        { type: 'PaymentMethod', id: customerId },
      ],
    }),

    attachPaymentMethod: builder.mutation<
      PaymentMethod,
      { paymentMethodId: string; customerId: string }
    >({
      query: (body) => ({
        url: '/payment-methods/attach',
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
      invalidatesTags: (_result, _err, arg) => [
        { type: 'PaymentMethod', id: arg.customerId },
      ],
    }),

    detachPaymentMethod: builder.mutation<
      { success: boolean },
      { id: string; customerId: string }
    >({
      query: ({ id }) => ({
        url: `/payment-methods/${id}/detach`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _err, arg) => [
        { type: 'PaymentMethod', id: arg.customerId },
      ],
    }),

    setDefaultPaymentMethod: builder.mutation<
      PaymentMethod,
      { id: string; customerId: string }
    >({
      query: ({ id }) => ({
        url: `/payment-methods/${id}/default`,
        method: 'PATCH',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
      invalidatesTags: (_result, _err, arg) => [
        { type: 'PaymentMethod', id: arg.customerId },
      ],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetCustomerPaymentMethodsQuery,
  useAttachPaymentMethodMutation,
  useDetachPaymentMethodMutation,
  useSetDefaultPaymentMethodMutation,
} = paymentMethodsApi;
