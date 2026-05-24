/**
 * Persisted shape of a Stripe Subscription record.
 * Mirrors the STRIPE_SUBSCRIPTIONS table in Oracle.
 */
export interface StripeSubscription {
  id: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  trialEnd?: Date;
  trialStart?: Date;
  stripePriceId: string;
  defaultPaymentMethodId?: string;
  customerId: string;
  metadata?: string;
  createdAt: Date;
  updatedAt: Date;
}
