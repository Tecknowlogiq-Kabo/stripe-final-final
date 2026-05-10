import { apiClient } from '@/lib/api-client';
import type { Customer, CreateCustomerInput, UpdateCustomerInput } from './customers.types';

class CustomersService {
  me(): Promise<Customer> {
    return apiClient.get('/customers/me');
  }

  get(id: string): Promise<Customer> {
    return apiClient.get(`/customers/${id}`);
  }

  create(data: CreateCustomerInput): Promise<Customer> {
    return apiClient.post('/customers', data, { 'Idempotency-Key': crypto.randomUUID() });
  }

  update(id: string, data: UpdateCustomerInput): Promise<Customer> {
    return apiClient.patch(`/customers/${id}`, data, { 'Idempotency-Key': crypto.randomUUID() });
  }
}

export const customersService = new CustomersService();
