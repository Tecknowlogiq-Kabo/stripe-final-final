export interface CreateCustomerDto {
  email: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
}

export interface UpdateCustomerDto {
  email?: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
}

export interface CustomerResponse {
  id: string;
  stripeCustomerId: string;
  email: string;
  name?: string;
  phone?: string;
  createdAt: string;
}

export interface CustomerSessionResponse {
  clientSecret: string;
}
