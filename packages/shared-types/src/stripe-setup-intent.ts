/**
 * Persisted shape of a Stripe SetupIntent record.
 * Mirrors the STRIPE_SETUP_INTENTS table in Oracle.
 */
export interface StripeSetupIntent {
  id: string;
  stripeSetupIntentId: string;
  status: string;
  clientSecret: string;
  customerId: string;
  stripePaymentMethodId?: string;
  idempotencyKey?: string;
  metadata?: string;
  description?: string;
  paymentMethodTypes?: string;
  usage?: string;
  lastSetupError?: string;
  nextAction?: string;
  livemode: boolean;
  createdAt: Date;
  updatedAt: Date;
}
