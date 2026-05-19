import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { ApiError } from './api-client';

const isBrowser = typeof window !== 'undefined';

function handleGlobalError(error: unknown): void {
  if (!isBrowser) return;

  if (error instanceof ApiError && error.status === 401) {
    // Session expired — redirect to login, preserving the current page as redirect target
    const currentPath = window.location.pathname + window.location.search;
    if (currentPath !== '/auth/login' && currentPath !== '/auth/register') {
      window.location.href = `/auth/login?redirect=${encodeURIComponent(currentPath)}`;
    }
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleGlobalError,
  }),
  mutationCache: new MutationCache({
    onError: handleGlobalError,
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
