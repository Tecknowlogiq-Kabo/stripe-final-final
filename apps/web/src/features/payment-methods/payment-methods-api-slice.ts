import { apiSlice } from '@/lib/api-slice';
import { queryFnResult } from '@/lib/query-fn-helper';
import { paymentMethodsService } from './payment-methods.service';
import type { PaymentMethod } from './payment-methods.types';

export const paymentMethodsApiSlice = apiSlice.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    // ── Queries ──────────────────────────────────────────────
    customerPaymentMethods: builder.query<PaymentMethod[], string>({
      queryFn: (customerId) => queryFnResult(() => paymentMethodsService.listByCustomer(customerId)),
      providesTags: (_result, _error, customerId) => [
        { type: 'PaymentMethod', id: `LIST-${customerId}` },
      ],
    }),

    // ── Mutations ────────────────────────────────────────────
    attachPaymentMethod: builder.mutation<
      PaymentMethod,
      { paymentMethodId: string; customerId: string }
    >({
      queryFn: ({ paymentMethodId, customerId }) =>
        queryFnResult(() => paymentMethodsService.attach(paymentMethodId, customerId)),
      invalidatesTags: (_result, _error, { customerId }) => [
        { type: 'PaymentMethod', id: `LIST-${customerId}` },
      ],
    }),

    detachPaymentMethod: builder.mutation<
      { success: boolean },
      { id: string; customerId: string }
    >({
      queryFn: ({ id }) => queryFnResult(() => paymentMethodsService.detach(id)),
      invalidatesTags: (_result, _error, { customerId }) => [
        { type: 'PaymentMethod', id: `LIST-${customerId}` },
      ],
    }),

    setDefaultPaymentMethod: builder.mutation<
      PaymentMethod,
      { id: string; customerId: string }
    >({
      queryFn: ({ id }) => queryFnResult(() => paymentMethodsService.setDefault(id)),
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
