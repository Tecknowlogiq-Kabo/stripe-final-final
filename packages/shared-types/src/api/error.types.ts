export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  stripeRequestId?: string;
  retryAfter?: number;
  timestamp: string;
  path: string;
}

export interface ValidationErrorResponse extends ApiErrorResponse {
  errors: Array<{
    field: string;
    message: string;
  }>;
}
