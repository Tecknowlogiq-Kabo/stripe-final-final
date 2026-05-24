export interface PaymentIntent {
  id: string;
  stripePaymentIntentId: string;
  amount: number;
  currency: string;
  status: string;
  description?: string;
  amountReceived?: number;
  receiptEmail?: string;
  statementDescriptor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentIntentListResponse {
  data: PaymentIntent[];
  total: number;
  page: number;
  limit: number;
}

export interface GetCustomerPaymentIntentsParams {
  page?: number;
  limit?: number;
  status?: string;
}
