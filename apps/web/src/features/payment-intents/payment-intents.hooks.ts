// Re-export from RTK Query api slice
// RTK Query keeps previous data in cache automatically while fetching new args.
// Use `isFetching` to show a loading indicator while `data` still holds the previous page.

import { paymentIntentKeys } from './payment-intents-keys';

export { paymentIntentKeys };

export { useCustomerPaymentIntentsQuery as useCustomerPaymentIntents } from './payment-intents-api-slice';
