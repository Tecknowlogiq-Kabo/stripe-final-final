import type { GetCustomerPaymentIntentsParams } from './payment-intents.types';

export const paymentIntentKeys = {
  byCustomer: (params: GetCustomerPaymentIntentsParams) =>
    ['payment-intents', 'mine', params.page, params.limit, params.status] as const,
};
