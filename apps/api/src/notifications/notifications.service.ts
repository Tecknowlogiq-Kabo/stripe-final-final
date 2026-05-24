import { Injectable } from '@nestjs/common';
import { Notification } from '../entities/notification.entity';
import { NotificationRepository } from '../billing/notification.repository';

@Injectable()
export class NotificationsService {
  constructor(private readonly notificationRepo: NotificationRepository) {}

  async findForCustomer(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: Notification[]; total: number }> {
    const data = await this.notificationRepo.findByCustomerId(customerId, limit);
    return { data, total: data.length };
  }

  async markRead(id: string): Promise<void> {
    return this.notificationRepo.markRead(id);
  }

  async markAllRead(customerId: string): Promise<void> {
    return this.notificationRepo.markAllRead(customerId);
  }
}
