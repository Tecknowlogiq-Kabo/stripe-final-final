export interface PaymentMethod {
  id: string;
  stripePaymentMethodId: string;
  type: string;
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
  details?: Record<string, unknown>;
  billingDetails?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: Record<string, string | null>;
  };
  cardWalletType?: string;
  country?: string;
  funding?: string;
  isDefault: boolean;
  createdAt: string;
}
