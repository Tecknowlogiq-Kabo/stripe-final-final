import { apiSlice } from '@/lib/api-slice';
import { queryFnResult, queryFnResultDetailed } from '@/lib/query-fn-helper';
import { customersService } from './customers.service';
import type { Customer, CreateCustomerInput, UpdateCustomerInput } from './customers.types';

export const customersApiSlice = apiSlice.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    // ── Queries ──────────────────────────────────────────────
    myCustomer: builder.query<Customer, void>({
      queryFn: () => queryFnResultDetailed(() => customersService.me()),
      providesTags: [{ type: 'Customer', id: 'ME' }],
    }),
    customer: builder.query<Customer, string>({
      queryFn: (id) => queryFnResult(() => customersService.get(id)),
      providesTags: (_result, _error, id) => [{ type: 'Customer', id }],
    }),

    // ── Mutations ────────────────────────────────────────────
    createCustomer: builder.mutation<Customer, CreateCustomerInput>({
      queryFn: (input) => queryFnResult(() => customersService.create(input)),
      invalidatesTags: [{ type: 'Customer', id: 'ME' }],
    }),
    updateCustomer: builder.mutation<Customer, { id: string } & UpdateCustomerInput>({
      queryFn: ({ id, ...data }) => queryFnResult(() => customersService.update(id, data)),
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
