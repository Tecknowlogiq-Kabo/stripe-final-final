import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersService } from './customers.service';
import type { CreateCustomerInput, UpdateCustomerInput } from './customers.types';

export const customerKeys = {
  me:     ['customers', 'me'] as const,
  detail: (id: string) => ['customers', id] as const,
};

export function useMyCustomer() {
  return useQuery({
    queryKey: customerKeys.me,
    queryFn:  customersService.me,
    // 404 = no customer yet (expected for new users) — don't waste a retry
    retry: (count, err) => !(err instanceof Error && 'status' in err && (err as { status: number }).status === 404) && count < 1,
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn:  () => customersService.get(id),
    enabled:  !!id,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCustomerInput) => customersService.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateCustomerInput) =>
      customersService.update(id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: customerKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: customerKeys.me });
    },
  });
}
