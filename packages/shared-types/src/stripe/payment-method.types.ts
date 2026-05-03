export interface PaymentMethodResponse {
  id: string;
  stripePaymentMethodId: string;
  type: string;
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
  customerId: string;
  isDefault: boolean;
  createdAt: string;
}

export interface AttachPaymentMethodDto {
  customerId: string;
}
