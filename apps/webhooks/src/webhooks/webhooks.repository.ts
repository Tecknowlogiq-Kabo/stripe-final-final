import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

interface WebhookEventRow {
  id: string;
  stripeEventId: string;
  eventType: string;
  payload: string;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class WebhooksRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findByStripeEventId(stripeEventId: string): Promise<WebhookEventRow | null> {
    const [row] = await this.dataSource.query<WebhookEventRow[]>(
      `SELECT ID AS "id", STRIPE_EVENT_ID AS "stripeEventId", EVENT_TYPE AS "eventType",
              PAYLOAD AS "payload", STATUS AS "status", ERROR_MESSAGE AS "errorMessage",
              RETRY_COUNT AS "retryCount", PROCESSED_AT AS "processedAt",
              CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"
       FROM STRIPE_WEBHOOK_EVENTS WHERE STRIPE_EVENT_ID = :1 AND ROWNUM = 1`,
      [stripeEventId],
    );
    return row ?? null;
  }

  async insert(
    id: string,
    stripeEventId: string,
    eventType: string,
    payload: string,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO STRIPE_WEBHOOK_EVENTS (ID, STRIPE_EVENT_ID, EVENT_TYPE, PAYLOAD, STATUS, RETRY_COUNT, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, :4, :5, :6, SYSDATE, SYSDATE)`,
      [id, stripeEventId, eventType, payload, 'pending', 0],
    );
  }

  async updateForRetry(
    id: string,
    eventType: string,
    payload: string,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_WEBHOOK_EVENTS SET EVENT_TYPE = :1, PAYLOAD = :2, STATUS = :3,
              ERROR_MESSAGE = NULL, RETRY_COUNT = :4, PROCESSED_AT = NULL, UPDATED_AT = SYSDATE
       WHERE ID = :5`,
      [eventType, payload, 'pending', 0, id],
    );
  }

  async getPayload(id: string): Promise<string> {
    const [row] = await this.dataSource.query<{ payload: string }[]>(
      `SELECT PAYLOAD AS "payload" FROM STRIPE_WEBHOOK_EVENTS WHERE ID = :1`,
      [id],
    );
    return row.payload;
  }

  async markProcessed(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_WEBHOOK_EVENTS SET STATUS = :1, PROCESSED_AT = SYSDATE, UPDATED_AT = SYSDATE WHERE ID = :2`,
      ['processed', id],
    );
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_WEBHOOK_EVENTS SET STATUS = :1, ERROR_MESSAGE = :2,
              RETRY_COUNT = RETRY_COUNT + 1, UPDATED_AT = SYSDATE WHERE ID = :3`,
      ['failed', errorMessage, id],
    );
  }
}
