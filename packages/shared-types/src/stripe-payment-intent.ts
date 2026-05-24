/**
 * Persisted shape of a Stripe PaymentIntent record.
 * Mirrors the STRIPE_PAYMENT_INTENTS table in Oracle.
 */
export interface StripePaymentIntent {
  id: string;
  stripePaymentIntentId: string;
  amount: number;
  currency: string;
  status: string;
  clientSecret: string;
  customerId?: string;
  stripePaymentMethodId?: string;
  idempotencyKey?: string;
  metadata?: string;
  description?: string;
  errorCode?: string;
  errorDeclineCode?: string;
  errorMessage?: string;
  setupFutureUsage?: string;
  nextAction?: string;
  paymentMethodTypes?: string;
  amountReceived?: number;
  amountCapturable?: number;
  receiptEmail?: string;
  statementDescriptor?: string;
  livemode: boolean;
  createdAt: Date;
  updatedAt: Date;
}
