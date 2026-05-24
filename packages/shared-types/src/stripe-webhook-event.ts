/**
 * Lifecycle states of a persisted Stripe webhook event.
 */
export type WebhookEventStatus = 'pending' | 'processed' | 'failed' | 'skipped';

/**
 * Persisted shape of a received Stripe webhook event.
 * Mirrors the STRIPE_WEBHOOK_EVENTS table in Oracle.
 */
export interface StripeWebhookEvent {
  id: string;
  stripeEventId: string;
  eventType: string;
  payload: string;
  status: WebhookEventStatus;
  errorMessage?: string;
  retryCount: number;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
