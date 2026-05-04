import { baseApi } from '../baseApi';

export interface PaymentMethod {
  id: string;
  stripePaymentMethodId: string;
  type: string;
  // Card-specific
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
  // Type-specific sub-object (sepa_debit, us_bank_account, ideal, etc.)
  details?: Record<string, unknown>;
  // Billing details from Stripe
  billingDetails?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: Record<string, string | null>;
  };
  // Wallet type for card PMs (apple_pay, google_pay, link, etc.)
  cardWalletType?: string;
  // ISO 3166-1 alpha-2 country code
  country?: string;
  // Card funding type: credit | debit | prepaid | unknown
  funding?: string;
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
