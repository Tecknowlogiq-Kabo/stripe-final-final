import { apiSlice } from '@/lib/api-slice';
import { queryFnResult } from '@/lib/query-fn-helper';
import { subscriptionsService } from './subscriptions.service';
import type {
  Subscription,
  SubscriptionPlan,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
} from './subscriptions.types';

export const subscriptionsApiSlice = apiSlice.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    // ── Queries ──────────────────────────────────────────────
    subscriptionPlans: builder.query<SubscriptionPlan[], void>({
      queryFn: () => queryFnResult(() => subscriptionsService.listPlans()),
      providesTags: ['SubscriptionPlan'],
    }),

    customerSubscriptions: builder.query<Subscription[], string>({
      queryFn: (customerId) =>
        queryFnResult(() => subscriptionsService.listByCustomer(customerId)),
      providesTags: (_result, _error, customerId) => [
        { type: 'Subscription', id: `LIST-${customerId}` },
      ],
    }),

    // ── Mutations ────────────────────────────────────────────
    createSubscription: builder.mutation<
      Subscription,
      CreateSubscriptionInput
    >({
      queryFn: (input) => queryFnResult(() => subscriptionsService.create(input)),
      invalidatesTags: (_result, _error, { customerId }) => [
        { type: 'Subscription', id: `LIST-${customerId}` },
      ],
    }),

    updateSubscription: builder.mutation<
      Subscription,
      { id: string } & UpdateSubscriptionInput
    >({
      queryFn: ({ id, ...data }) =>
        queryFnResult(() => subscriptionsService.update(id, data)),
      invalidatesTags: ['Subscription'],
    }),

    cancelSubscription: builder.mutation<Subscription, string>({
      queryFn: (id) => queryFnResult(() => subscriptionsService.cancel(id)),
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
