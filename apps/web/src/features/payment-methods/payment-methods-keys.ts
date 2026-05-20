export const paymentMethodKeys = {
  byCustomer: (customerId: string) => ['payment-methods', customerId] as const,
};
