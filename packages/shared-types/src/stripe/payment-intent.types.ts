export interface CreatePaymentIntentDto {
  amount: number;
  currency: string;
  customerId: string;
  paymentMethodId?: string;
  setupFutureUsage?: 'on_session' | 'off_session';
  receiptEmail?: string;
  statementDescriptor?: string;
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
  setupFutureUsage?: string;
  paymentMethodTypes?: string[];
  amountReceived?: number;
  amountCapturable?: number;
  nextAction?: Record<string, unknown>;
  receiptEmail?: string;
  statementDescriptor?: string;
  livemode?: boolean;
  createdAt: string;
}

export interface ConfirmPaymentIntentDto {
  paymentMethodId?: string;
  returnUrl?: string;
}
