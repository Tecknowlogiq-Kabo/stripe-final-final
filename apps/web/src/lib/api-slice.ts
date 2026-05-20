import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';

const API_URL =
  typeof window === 'undefined'
    ? (process.env.API_URL ?? 'http://localhost:3001')
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001');

/**
 * Builds Cookie header from httpOnly cookies (server-side only).
 */
async function getServerCookieHeader(): Promise<Record<string, string>> {
  if (typeof window !== 'undefined') return {};
  try {
    const { cookies } = await import('next/headers');
    const jar = cookies();
    const authToken = jar.get('auth_token')?.value;
    const refreshToken = jar.get('refresh_token')?.value;
    const parts: string[] = [];
    if (authToken) parts.push(`auth_token=${authToken}`);
    if (refreshToken) parts.push(`refresh_token=${refreshToken}`);
    return parts.length ? { Cookie: parts.join('; ') } : {};
  } catch {
    return {};
  }
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: `${API_URL}/api/v1`,
  credentials: 'include',
  prepareHeaders: async (headers) => {
    // Forward cookies on server-side requests
    const serverCookie = await getServerCookieHeader();
    if (serverCookie.Cookie) {
      headers.set('Cookie', serverCookie.Cookie);
    }
    return headers;
  },
});

/**
 * Custom baseQuery that handles 401 → silent token refresh → retry once.
 * If refresh also fails, redirects to /auth/login preserving the current page
 * as a redirect target.
 */
const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  let result = await rawBaseQuery(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    // Attempt silent token refresh
    const refreshResult = await rawBaseQuery(
      { url: '/auth/refresh', method: 'POST' },
      api,
      extraOptions,
    );

    if (refreshResult.data) {
      // Retry the original request with refreshed cookies
      result = await rawBaseQuery(args, api, extraOptions);
    } else {
      // Session expired — redirect to login
      if (typeof window !== 'undefined') {
        const currentPath = window.location.pathname + window.location.search;
        if (currentPath !== '/auth/login' && currentPath !== '/auth/register') {
          window.location.href = `/auth/login?redirect=${encodeURIComponent(currentPath)}`;
        }
      }
    }
  }

  return result;
};

export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: [
    'Customer',
    'PaymentMethod',
    'PaymentIntent',
    'Subscription',
    'SubscriptionPlan',
  ],
  endpoints: () => ({}),
});
