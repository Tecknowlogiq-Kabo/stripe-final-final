import { apiSlice } from '@/lib/api-slice';
import { authService } from './auth.service';
import type { AuthInput, AuthResult } from './auth.types';

export const authApiSlice = apiSlice.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    login: builder.mutation<AuthResult, AuthInput>({
      queryFn: (input) => authService.login(input).then((data) => ({ data })).catch((error: Error) => ({ error: { status: 'CUSTOM_ERROR', error: error.message } })),
    }),
    register: builder.mutation<AuthResult, AuthInput>({
      queryFn: (input) => authService.register(input).then((data) => ({ data })).catch((error: Error) => ({ error: { status: 'CUSTOM_ERROR', error: error.message } })),
    }),
  }),
});

export const { useLoginMutation, useRegisterMutation } = authApiSlice;
