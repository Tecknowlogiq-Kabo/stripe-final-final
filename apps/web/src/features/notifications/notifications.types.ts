export interface Notification {
  id: string;
  customerId: string;
  type: 'payment_failed' | 'payment_success' | string;
  title: string;
  message: string;
  isRead: boolean;
  metadata?: string;
  createdAt: string;
}
