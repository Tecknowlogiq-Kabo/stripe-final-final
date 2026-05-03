export interface CreatePaymentIntentDto {
  amount: number;
  currency: string;
  customerId: string;
  paymentMethodId?: string;
  setupFutureUsage?: 'on_session' | 'off_session';
  metadata?: Record<string, string>;
  description?: string;
}

export interface PaymentIntentResponse {
  id: string;
  stripePaymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
  customerId: string;
  createdAt: string;
}

export interface ConfirmPaymentIntentDto {
  paymentMethodId?: string;
  returnUrl?: string;
}
