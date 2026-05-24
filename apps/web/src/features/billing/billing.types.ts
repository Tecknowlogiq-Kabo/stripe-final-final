export interface BillingRecord {
  id: string;
  subscriptionId: string;
  chargeAmount: number; // cents
  currency: string;
  status: 'pending' | 'locked' | 'charged' | 'failed';
  periodDate: string;
  lockedAt?: string;
  chargedAt?: string;
  stripePaymentIntentId?: string;
  failureMessage?: string;
  createdAt: string;
}

export interface TriggerResult {
  status: string;
  stripePaymentIntentId?: string;
  error?: string;
}
