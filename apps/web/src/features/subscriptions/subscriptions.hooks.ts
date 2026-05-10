import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { subscriptionsService } from './subscriptions.service';
import type { CreateSubscriptionInput, UpdateSubscriptionInput } from './subscriptions.types';

export const subscriptionKeys = {
  plans:          ['subscription-plans'] as const,
  byCustomer:     (customerId: string) => ['subscriptions', 'customer', customerId] as const,
};

export function useSubscriptionPlans() {
  return useQuery({
    queryKey: subscriptionKeys.plans,
    queryFn:  subscriptionsService.listPlans,
  });
}

export function useCustomerSubscriptions(customerId: string) {
  return useQuery({
    queryKey: subscriptionKeys.byCustomer(customerId),
    queryFn:  () => subscriptionsService.listByCustomer(customerId),
    enabled:  !!customerId,
  });
}

export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSubscriptionInput) => subscriptionsService.create(data),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: subscriptionKeys.byCustomer(vars.customerId) }),
  });
}

export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateSubscriptionInput) =>
      subscriptionsService.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscriptions'] }),
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => subscriptionsService.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscriptions'] }),
  });
}
