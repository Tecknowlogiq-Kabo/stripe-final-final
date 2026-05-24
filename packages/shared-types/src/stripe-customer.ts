/**
 * Persisted shape of a Stripe customer record.
 * Mirrors the STRIPE_CUSTOMERS table in Oracle.
 */
export interface StripeCustomer {
  id: string;
  stripeCustomerId: string;
  email: string;
  name?: string;
  phone?: string;
  metadata?: string;
  idempotencyKey?: string;
  userId?: string;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}
