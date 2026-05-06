import {
  createApi,
  fetchBaseQuery,
  FetchBaseQueryError,
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryMeta,
} from '@reduxjs/toolkit/query/react';
import { setCredentials, clearCredentials } from './slices/authSlice';
import type { AuthResult } from '../actions/auth';

/**
 * Root RTK Query API slice — all feature slices extend this via `injectEndpoints`.
 *
 * Uses NEXT_PUBLIC_API_URL so it works in Client Components.
 * Server-side operations (createPaymentIntent, createSetupIntent) continue to use
 * Next.js Server Actions because they need the Docker-internal URL and server-side
 * idempotency-key generation.
 */
const rawBaseQuery = fetchBaseQuery({
  baseUrl: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1`,
  credentials: 'include',
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
});

/**
 * Wraps rawBaseQuery with silent token refresh on 401.
 * Uses the stored refreshToken to get a new access/refresh pair, then retries.
 * On refresh failure, clears credentials (forces re-login).
 */
const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError,
  object,
  FetchBaseQueryMeta
> = async (args, api, extra) => {
  let result = await rawBaseQuery(args, api, extra);

  if (result.error?.status === 401) {
    const refreshResult = await rawBaseQuery(
      { url: '/auth/refresh', method: 'POST', body: {} },
      api,
      extra,
    );
    if (refreshResult.data) {
      api.dispatch(setCredentials(refreshResult.data as AuthResult));
      result = await rawBaseQuery(args, api, extra);
    } else {
      api.dispatch(clearCredentials());
    }
  }

  return result;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['Customer', 'PaymentMethod', 'PaymentIntent', 'Subscription', 'Plan'],
  endpoints: () => ({}),
});

/** Re-export RTK error type for feature slices */
export type { FetchBaseQueryError };
