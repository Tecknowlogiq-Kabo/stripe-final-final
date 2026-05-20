// Re-export from RTK Query api slice
// Tag-based cache invalidation replaces the old queryClient.invalidateQueries calls.

import { paymentMethodKeys } from './payment-methods-keys';

export { paymentMethodKeys };

export {
  useCustomerPaymentMethodsQuery as useCustomerPaymentMethods,
  useAttachPaymentMethodMutation as useAttachPaymentMethod,
  useDetachPaymentMethodMutation as useDetachPaymentMethod,
  useSetDefaultPaymentMethodMutation as useSetDefaultPaymentMethod,
} from './payment-methods-api-slice';
