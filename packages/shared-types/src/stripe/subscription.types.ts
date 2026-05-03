export interface CreateSubscriptionDto {
  customerId: string;
  priceId: string;
  paymentMethodId?: string;
  trialPeriodDays?: number;
  metadata?: Record<string, string>;
}

export interface UpdateSubscriptionDto {
  priceId?: string;
  paymentMethodId?: string;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, string>;
}

export interface SubscriptionResponse {
  id: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEnd?: string;
  stripePriceId: string;
  customerId: string;
  createdAt: string;
}

export interface SubscriptionPlanResponse {
  id: string;
  stripePriceId: string;
  stripeProductId: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  isActive: boolean;
}
