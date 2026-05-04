export interface CreateSetupIntentDto {
  customerId: string;
  paymentMethodTypes?: string[];
  usage?: 'off_session' | 'on_session';
  metadata?: Record<string, string>;
  description?: string;
}

export interface SetupIntentResponse {
  id: string;
  stripeSetupIntentId: string;
  clientSecret: string;
  status: string;
  customerId: string;
  paymentMethodTypes?: string[];
  usage?: string;
  nextAction?: Record<string, unknown>;
  livemode?: boolean;
  createdAt: string;
}
