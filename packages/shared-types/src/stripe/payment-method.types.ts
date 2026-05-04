export interface StripeBillingDetails {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
}

export interface PaymentMethodResponse {
  id: string;
  stripePaymentMethodId: string;
  type: string;
  // Card-specific (null for non-card types)
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
  // Type-specific sub-object (sepa_debit, us_bank_account, ideal, etc.)
  details?: Record<string, unknown>;
  // Parsed billing_details from Stripe
  billingDetails?: StripeBillingDetails;
  // Wallet type for card PMs (apple_pay, google_pay, link, etc.)
  cardWalletType?: string;
  // ISO 3166-1 alpha-2 country code
  country?: string;
  // Card funding type: credit | debit | prepaid | unknown
  funding?: string;
  customerId: string;
  isDefault: boolean;
  createdAt: string;
}

export interface AttachPaymentMethodDto {
  customerId: string;
}
