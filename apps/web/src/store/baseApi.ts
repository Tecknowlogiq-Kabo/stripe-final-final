import { createApi, fetchBaseQuery, FetchBaseQueryError } from '@reduxjs/toolkit/query/react';

/**
 * Root RTK Query API slice — all feature slices extend this via `injectEndpoints`.
 *
 * Uses NEXT_PUBLIC_API_URL so it works in Client Components.
 * Server-side operations (createPaymentIntent, createSetupIntent) continue to use
 * Next.js Server Actions because they need the Docker-internal URL and server-side
 * idempotency-key generation.
 */
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1`,
    prepareHeaders: (headers) => {
      headers.set('Content-Type', 'application/json');
      return headers;
    },
    responseHandler: async (response) => {
      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
  }),
  tagTypes: ['Customer', 'PaymentMethod', 'PaymentIntent', 'Subscription', 'Plan'],
  endpoints: () => ({}),
});

/** Re-export RTK error type for feature slices */
export type { FetchBaseQueryError };
