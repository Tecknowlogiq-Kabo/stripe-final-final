import { baseApi } from '../baseApi';

export interface Plan {
  id: string;
  stripePriceId: string;
  stripeProductId: string;
  name: string;
  description?: string;
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  isActive: boolean;
}

export interface Subscription {
  id: string;
  stripeSubscriptionId: string;
  status: string;
  stripePriceId: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialStart?: string;
  trialEnd?: string;
  createdAt: string;
}

export interface CreateSubscriptionInput {
  customerId: string;
  priceId: string;
  paymentMethodId?: string;
  trialPeriodDays?: number;
  metadata?: Record<string, string>;
}

export interface UpdateSubscriptionInput {
  priceId?: string;
  paymentMethodId?: string;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, string>;
}

export const subscriptionsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getPlans: builder.query<Plan[], void>({
      query: () => '/subscriptions/plans',
      providesTags: ['Plan'],
    }),

    getCustomerSubscriptions: builder.query<Subscription[], string>({
      query: (customerId) => `/subscriptions/customer/${customerId}`,
      providesTags: (_result, _err, customerId) => [
        { type: 'Subscription', id: customerId },
      ],
    }),

    createSubscription: builder.mutation<
      Subscription,
      CreateSubscriptionInput
    >({
      query: (body) => ({
        url: '/subscriptions',
        method: 'POST',
        body,
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
        },
      }),
      invalidatesTags: (_result, _err, arg) => [
        { type: 'Subscription', id: arg.customerId },
      ],
    }),

    updateSubscription: builder.mutation<
      Subscription,
      { id: string } & UpdateSubscriptionInput
    >({
      query: ({ id, ...body }) => ({
        url: `/subscriptions/${id}`,
        method: 'PATCH',
        body,
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
        },
      }),
      invalidatesTags: ['Subscription'],
    }),

    cancelSubscription: builder.mutation<Subscription, string>({
      query: (id) => ({
        url: `/subscriptions/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Subscription'],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetPlansQuery,
  useGetCustomerSubscriptionsQuery,
  useCreateSubscriptionMutation,
  useUpdateSubscriptionMutation,
  useCancelSubscriptionMutation,
} = subscriptionsApi;
