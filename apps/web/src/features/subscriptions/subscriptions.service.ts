import { apiClient } from '@/lib/api-client';
import type {
  Subscription,
  SubscriptionPlan,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
} from './subscriptions.types';

export const subscriptionsService = {
  listPlans: (): Promise<SubscriptionPlan[]> =>
    apiClient.get('/subscriptions/plans'),

  listByCustomer: (customerId: string): Promise<Subscription[]> =>
    apiClient.get(`/subscriptions/customer/${customerId}`),

  create: (data: CreateSubscriptionInput): Promise<Subscription> =>
    apiClient.post('/subscriptions', data, { 'Idempotency-Key': crypto.randomUUID() }),

  update: (id: string, data: UpdateSubscriptionInput): Promise<Subscription> =>
    apiClient.patch(`/subscriptions/${id}`, data, { 'Idempotency-Key': crypto.randomUUID() }),

  cancel: (id: string): Promise<Subscription> =>
    apiClient.delete(`/subscriptions/${id}`),
};
