export interface Customer {
  id: string;
  stripeCustomerId: string;
  email: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
  isDeleted: boolean;
  createdAt: string;
}

export interface CreateCustomerInput {
  email: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
}

export type UpdateCustomerInput = Partial<CreateCustomerInput>;
