import { apiSlice } from '@/lib/api-slice';
import { apiClient } from '@/lib/api-client';
import type {
  Subscription,
  SubscriptionPlan,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
} from './subscriptions.types';

export const subscriptionsApiSlice = apiSlice.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    subscriptionPlans: builder.query<SubscriptionPlan[], void>({
      queryFn: () =>
        apiClient.get<SubscriptionPlan[]>('/subscriptions/plans').then((data) => ({ data })),
      providesTags: ['SubscriptionPlan'],
    }),

    customerSubscriptions: builder.query<Subscription[], string>({
      queryFn: (customerId) =>
        apiClient
          .get<{ data: Subscription[] } | Subscription[]>(
            `/subscriptions/customer/${customerId}`,
          )
          .then((res) => ({ data: Array.isArray(res) ? res : res.data })),
      providesTags: (_result, _error, customerId) => [
        { type: 'Subscription', id: `LIST-${customerId}` },
      ],
    }),

    createSubscription: builder.mutation<Subscription, CreateSubscriptionInput>({
      queryFn: (input) =>
        apiClient.post<Subscription>('/subscriptions', input).then((data) => ({ data })),
      invalidatesTags: (_result, _error, { customerId }) => [
        { type: 'Subscription', id: `LIST-${customerId}` },
      ],
    }),

    updateSubscription: builder.mutation<
      Subscription,
      { id: string } & UpdateSubscriptionInput
    >({
      queryFn: ({ id, ...data }) =>
        apiClient.patch<Subscription>(`/subscriptions/${id}`, data).then((data) => ({ data })),
      invalidatesTags: ['Subscription'],
    }),

    cancelSubscription: builder.mutation<Subscription, string>({
      queryFn: (id) =>
        apiClient.delete<Subscription>(`/subscriptions/${id}`).then((data) => ({ data })),
      invalidatesTags: ['Subscription'],
    }),
  }),
});

export const {
  useSubscriptionPlansQuery,
  useCustomerSubscriptionsQuery,
  useCreateSubscriptionMutation,
  useUpdateSubscriptionMutation,
  useCancelSubscriptionMutation,
} = subscriptionsApiSlice;
