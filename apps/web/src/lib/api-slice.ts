import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

const API_URL =
  typeof window === 'undefined'
    ? (process.env.API_URL ?? 'http://localhost:3001')
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001');

export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: `${API_URL}/api/v1`,
    credentials: 'include',
  }),
  tagTypes: [
    'Customer',
    'PaymentMethod',
    'PaymentIntent',
    'Subscription',
    'SubscriptionPlan',
  ],
  endpoints: () => ({}),
});
