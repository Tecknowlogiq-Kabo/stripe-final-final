/**
 * Persisted shape of a Stripe PaymentMethod record.
 * Mirrors the STRIPE_PAYMENT_METHODS table in Oracle.
 */
export interface StripePaymentMethod {
  id: string;
  stripePaymentMethodId: string;
  type: string;
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
  fingerprint?: string;
  details?: string;
  billingDetails?: string;
  cardWalletType?: string;
  country?: string;
  funding?: string;
  customerId: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}
