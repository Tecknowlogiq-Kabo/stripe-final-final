import { apiSlice } from '@/lib/api-slice';
import { API_URL } from '@/lib/api-client';
import type { AuthInput, AuthResult } from './auth.types';

async function authFetch(endpoint: string, input: AuthInput): Promise<AuthResult> {
  const res = await fetch(`${API_URL}/api/v1/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    credentials: 'include',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? 'Auth failed');
  }

  return res.json() as Promise<AuthResult>;
}

export const authApiSlice = apiSlice.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    login: builder.mutation<AuthResult, AuthInput>({
      queryFn: (input) => authFetch('login', input).then((data) => ({ data })),
    }),
    register: builder.mutation<AuthResult, AuthInput>({
      queryFn: (input) => authFetch('register', input).then((data) => ({ data })),
    }),
  }),
});

export const { useLoginMutation, useRegisterMutation } = authApiSlice;
