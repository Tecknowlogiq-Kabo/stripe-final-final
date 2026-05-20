// Re-export from RTK Query api slice
// Tag-based cache invalidation replaces the old queryClient.invalidateQueries calls.

import { subscriptionKeys } from './subscriptions-keys';

export { subscriptionKeys };

export {
  useSubscriptionPlansQuery as useSubscriptionPlans,
  useCustomerSubscriptionsQuery as useCustomerSubscriptions,
  useCreateSubscriptionMutation as useCreateSubscription,
  useUpdateSubscriptionMutation as useUpdateSubscription,
  useCancelSubscriptionMutation as useCancelSubscription,
} from './subscriptions-api-slice';
