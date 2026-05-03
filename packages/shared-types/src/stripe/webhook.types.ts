export type WebhookEventStatus = 'pending' | 'processed' | 'failed' | 'skipped';

export interface WebhookEventResponse {
  id: string;
  stripeEventId: string;
  eventType: string;
  status: WebhookEventStatus;
  retryCount: number;
  processedAt?: string;
  createdAt: string;
}
