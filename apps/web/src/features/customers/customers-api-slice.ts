import { apiSlice } from '@/lib/api-slice';
import { apiClient } from '@/lib/api-client';
import type { Customer, CreateCustomerInput, UpdateCustomerInput } from './customers.types';

export const customersApiSlice = apiSlice.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    myCustomer: builder.query<Customer, void>({
      queryFn: () => apiClient.get<Customer>('/customers/me').then((data) => ({ data })),
      providesTags: [{ type: 'Customer', id: 'ME' }],
    }),
    customer: builder.query<Customer, string>({
      queryFn: (id) => apiClient.get<Customer>(`/customers/${id}`).then((data) => ({ data })),
      providesTags: (_result, _error, id) => [{ type: 'Customer', id }],
    }),
    createCustomer: builder.mutation<Customer, CreateCustomerInput>({
      queryFn: (input) => apiClient.post<Customer>('/customers', input).then((data) => ({ data })),
      invalidatesTags: [{ type: 'Customer', id: 'ME' }],
    }),
    updateCustomer: builder.mutation<Customer, { id: string } & UpdateCustomerInput>({
      queryFn: ({ id, ...data }) =>
        apiClient.patch<Customer>(`/customers/${id}`, data).then((data) => ({ data })),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Customer', id },
        { type: 'Customer', id: 'ME' },
      ],
    }),
  }),
});

export const {
  useMyCustomerQuery,
  useCustomerQuery,
  useCreateCustomerMutation,
  useUpdateCustomerMutation,
} = customersApiSlice;
