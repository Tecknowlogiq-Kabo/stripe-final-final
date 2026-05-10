import { apiClient } from '@/lib/api-client';
import type {
  Subscription,
  SubscriptionPlan,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
} from './subscriptions.types';

class SubscriptionsService {
  listPlans(): Promise<SubscriptionPlan[]> {
    return apiClient.get('/subscriptions/plans');
  }

  listByCustomer(customerId: string): Promise<Subscription[]> {
    return apiClient
      .get<{ data: Subscription[] } | Subscription[]>(`/subscriptions/customer/${customerId}`)
      .then((res) => (Array.isArray(res) ? res : res.data));
  }

  create(data: CreateSubscriptionInput): Promise<Subscription> {
    return apiClient.post('/subscriptions', data, { 'Idempotency-Key': crypto.randomUUID() });
  }

  update(id: string, data: UpdateSubscriptionInput): Promise<Subscription> {
    return apiClient.patch(`/subscriptions/${id}`, data, { 'Idempotency-Key': crypto.randomUUID() });
  }

  cancel(id: string): Promise<Subscription> {
    return apiClient.delete(`/subscriptions/${id}`);
  }
}

export const subscriptionsService = new SubscriptionsService();
