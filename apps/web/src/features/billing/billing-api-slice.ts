import { apiSlice } from '@/lib/api-slice';
import { apiClient } from '@/lib/api-client';
import type { BillingRecord, TriggerResult } from './billing.types';

export const billingApiSlice = apiSlice.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    subscriptionBillingRecords: builder.query<BillingRecord[], string>({
      queryFn: (subscriptionId) =>
        apiClient
          .get<BillingRecord[]>(`/billing/records/${subscriptionId}`)
          .then((data) => ({ data })),
      providesTags: (_result, _error, subId) => [{ type: 'BillingRecord', id: subId }],
    }),

    createBillingRecord: builder.mutation<
      BillingRecord,
      { subscriptionId: string; chargeAmount: number; currency?: string }
    >({
      queryFn: (input) =>
        apiClient.post<BillingRecord>('/billing/dev/records', input).then((data) => ({ data })),
      invalidatesTags: (_result, _error, { subscriptionId }) => [
        { type: 'BillingRecord', id: subscriptionId },
      ],
    }),

    triggerCharge: builder.mutation<TriggerResult, string>({
      queryFn: (subscriptionId) =>
        apiClient
          .post<TriggerResult>(`/billing/dev/trigger/${subscriptionId}`, {})
          .then((data) => ({ data })),
      invalidatesTags: ['BillingRecord', 'Subscription'],
    }),
  }),
});

export const {
  useSubscriptionBillingRecordsQuery,
  useCreateBillingRecordMutation,
  useTriggerChargeMutation,
} = billingApiSlice;
