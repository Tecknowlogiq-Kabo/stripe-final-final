export interface CreateSetupIntentDto {
  customerId: string;
  paymentMethodTypes?: string[];
  metadata?: Record<string, string>;
  description?: string;
}

export interface SetupIntentResponse {
  id: string;
  stripeSetupIntentId: string;
  clientSecret: string;
  status: string;
  customerId: string;
  createdAt: string;
}
