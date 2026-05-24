import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { NOTIFICATION_SELECT } from '../database/query-constants';

@Injectable()
export class NotificationRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async insert(
    id: string,
    customerId: string,
    type: string,
    title: string,
    message: string,
    metadata?: string,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO NOTIFICATIONS (ID, CUSTOMER_ID, TYPE, TITLE, MESSAGE, IS_READ, METADATA, CREATED_AT)
       VALUES (:1, :2, :3, :4, :5, 0, :6, SYSDATE)`,
      [id, customerId, type, title, message, metadata ?? null],
    );
  }

  async findByCustomerId(
    customerId: string,
    limit = 20,
    onlyUnread = false,
  ): Promise<Notification[]> {
    const unreadClause = onlyUnread ? `AND IS_READ = 0` : '';
    return this.dataSource.query<Notification[]>(
      `SELECT ${NOTIFICATION_SELECT} FROM NOTIFICATIONS WHERE CUSTOMER_ID = :1 ${unreadClause} ORDER BY CREATED_AT DESC FETCH NEXT :2 ROWS ONLY`,
      [customerId, limit],
    );
  }

  async markRead(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE NOTIFICATIONS SET IS_READ = 1 WHERE ID = :1`,
      [id],
    );
  }

  async markAllRead(customerId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE NOTIFICATIONS SET IS_READ = 1 WHERE CUSTOMER_ID = :1`,
      [customerId],
    );
  }
}
