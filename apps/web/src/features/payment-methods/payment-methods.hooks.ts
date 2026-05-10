import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentMethodsService } from './payment-methods.service';
import type { PaymentMethod } from './payment-methods.types';

export const paymentMethodKeys = {
  byCustomer: (customerId: string) => ['payment-methods', customerId] as const,
};

export function useCustomerPaymentMethods(customerId: string) {
  return useQuery({
    queryKey: paymentMethodKeys.byCustomer(customerId),
    queryFn:  () => paymentMethodsService.listByCustomer(customerId),
    enabled:  !!customerId,
  });
}

type WithCustomerId = { id: string; customerId: string };

export function useDetachPaymentMethod() {
  const qc = useQueryClient();
  return useMutation<{ success: boolean }, Error, WithCustomerId>({
    mutationFn: ({ id }) => paymentMethodsService.detach(id),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: paymentMethodKeys.byCustomer(vars.customerId) }),
  });
}

export function useSetDefaultPaymentMethod() {
  const qc = useQueryClient();
  return useMutation<PaymentMethod, Error, WithCustomerId>({
    mutationFn: ({ id }) => paymentMethodsService.setDefault(id),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: paymentMethodKeys.byCustomer(vars.customerId) }),
  });
}

export function useAttachPaymentMethod() {
  const qc = useQueryClient();
  return useMutation<PaymentMethod, Error, { paymentMethodId: string; customerId: string }>({
    mutationFn: ({ paymentMethodId, customerId }) =>
      paymentMethodsService.attach(paymentMethodId, customerId),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: paymentMethodKeys.byCustomer(vars.customerId) }),
  });
}
