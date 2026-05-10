export interface SubscriptionPlan {
  id: string;
  stripePriceId: string;
  stripeProductId: string;
  name: string;
  description?: string;
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  isActive: boolean;
}

export interface Subscription {
  id: string;
  stripeSubscriptionId: string;
  status: string;
  stripePriceId: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialStart?: string;
  trialEnd?: string;
  createdAt: string;
}

export interface CreateSubscriptionInput {
  customerId: string;
  priceId: string;
  paymentMethodId?: string;
  trialPeriodDays?: number;
  metadata?: Record<string, string>;
}

export interface UpdateSubscriptionInput {
  priceId?: string;
  paymentMethodId?: string;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, string>;
}
