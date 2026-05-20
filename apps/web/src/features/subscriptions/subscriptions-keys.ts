export const subscriptionKeys = {
  plans:          ['subscription-plans'] as const,
  byCustomer:     (customerId: string) => ['subscriptions', 'customer', customerId] as const,
};
