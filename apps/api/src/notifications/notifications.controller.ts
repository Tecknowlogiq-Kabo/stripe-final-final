import {
  Controller,
  Get,
  Patch,
  Param,
  Request,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CustomersService } from '../customers/customers.service';
import { Notification } from '../entities/notification.entity';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly customersService: CustomersService,
  ) {}

  @Get('me')
  async getMyNotifications(
    @Request() req: { user: { id: string } },
  ): Promise<{ data: Notification[]; total: number }> {
    const customer = await this.customersService.findByUserId(req.user.id);
    if (!customer) return { data: [], total: 0 };
    return this.notificationsService.findForCustomer(customer.id);
  }

  @Patch('read-all')
  async markAllRead(
    @Request() req: { user: { id: string } },
  ): Promise<void> {
    const customer = await this.customersService.findByUserId(req.user.id);
    if (!customer) return;
    return this.notificationsService.markAllRead(customer.id);
  }

  @Patch(':id/read')
  async markRead(@Param('id') id: string): Promise<void> {
    return this.notificationsService.markRead(id);
  }
}
