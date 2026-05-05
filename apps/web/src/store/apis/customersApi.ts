import { baseApi } from '../baseApi';

export interface Customer {
  id: string;
  stripeCustomerId: string;
  email: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
  isDeleted: boolean;
  createdAt: string;
}

export interface CreateCustomerInput {
  email: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
}

export const customersApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCustomer: builder.query<Customer, string>({
      query: (id) => `/customers/${id}`,
      providesTags: (_result, _err, id) => [{ type: 'Customer', id }],
    }),

    getMyCustomer: builder.query<Customer, void>({
      query: () => '/customers/me',
      providesTags: (result) =>
        result ? [{ type: 'Customer', id: result.id }] : ['Customer'],
    }),

    createCustomer: builder.mutation<Customer, CreateCustomerInput>({
      query: (body) => ({
        url: '/customers',
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
      invalidatesTags: ['Customer'],
    }),

    updateCustomer: builder.mutation<Customer, { id: string } & Partial<CreateCustomerInput>>({
      query: ({ id, ...body }) => ({
        url: `/customers/${id}`,
        method: 'PATCH',
        body,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
      invalidatesTags: (_result, _err, arg) => [{ type: 'Customer', id: arg.id }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetCustomerQuery,
  useGetMyCustomerQuery,
  useCreateCustomerMutation,
  useUpdateCustomerMutation,
} = customersApi;
