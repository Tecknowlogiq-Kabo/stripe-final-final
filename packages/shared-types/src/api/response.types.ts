export interface ApiSuccessResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}
