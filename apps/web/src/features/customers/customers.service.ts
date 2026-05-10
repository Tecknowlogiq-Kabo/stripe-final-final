import { apiClient } from '@/lib/api-client';
import type { Customer, CreateCustomerInput, UpdateCustomerInput } from './customers.types';

export const customersService = {
  me:     (): Promise<Customer>                      => apiClient.get('/customers/me'),
  get:    (id: string): Promise<Customer>            => apiClient.get(`/customers/${id}`),
  create: (data: CreateCustomerInput): Promise<Customer> =>
    apiClient.post('/customers', data, { 'Idempotency-Key': crypto.randomUUID() }),
  update: (id: string, data: UpdateCustomerInput): Promise<Customer> =>
    apiClient.patch(`/customers/${id}`, data, { 'Idempotency-Key': crypto.randomUUID() }),
};
