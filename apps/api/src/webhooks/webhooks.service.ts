import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import {
  StripeWebhookEvent,
} from '../entities/stripe-webhook-event.entity';
import { PaymentIntentHandler } from './handlers/payment-intent.handler';
import { SetupIntentHandler } from './handlers/setup-intent.handler';
import { SubscriptionHandler } from './handlers/subscription.handler';
import { InvoiceHandler } from './handlers/invoice.handler';
import { PaymentMethodHandler } from './handlers/payment-method.handler';
import { CustomerHandler } from './handlers/customer.handler';
import { MandateHandler } from './handlers/mandate.handler';
import { WEBHOOK_SELECT } from '../database/query-constants';
import { WEBHOOK_QUEUE } from './webhook-queue.constants';

type WebhookHandler = { handle: (event: Stripe.Event) => Promise<void> };

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly handlerRegistry: Map<string, WebhookHandler>;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectQueue(WEBHOOK_QUEUE)
    private readonly webhookQueue: Queue,
    private readonly paymentIntentHandler: PaymentIntentHandler,
    private readonly setupIntentHandler: SetupIntentHandler,
    private readonly subscriptionHandler: SubscriptionHandler,
    private readonly invoiceHandler: InvoiceHandler,
    private readonly paymentMethodHandler: PaymentMethodHandler,
    private readonly customerHandler: CustomerHandler,
    private readonly mandateHandler: MandateHandler,
  ) {
    this.handlerRegistry = new Map<string, WebhookHandler>([
      ['payment_intent.succeeded', paymentIntentHandler],
      ['payment_intent.payment_failed', paymentIntentHandler],
      ['payment_intent.canceled', paymentIntentHandler],
      ['payment_intent.processing', paymentIntentHandler],
      ['payment_intent.requires_action', paymentIntentHandler],
      ['setup_intent.succeeded', setupIntentHandler],
      ['setup_intent.setup_failed', setupIntentHandler],
      ['setup_intent.canceled', setupIntentHandler],
      ['customer.subscription.created', subscriptionHandler],
      ['customer.subscription.updated', subscriptionHandler],
      ['customer.subscription.deleted', subscriptionHandler],
      ['customer.subscription.trial_will_end', subscriptionHandler],
      ['customer.subscription.paused', subscriptionHandler],
      ['customer.subscription.resumed', subscriptionHandler],
      ['invoice.payment_succeeded', invoiceHandler],
      ['invoice.payment_failed', invoiceHandler],
      ['invoice.upcoming', invoiceHandler],
      ['invoice.created', invoiceHandler],
      ['invoice.finalized', invoiceHandler],
      ['payment_method.attached', paymentMethodHandler],
      ['payment_method.detached', paymentMethodHandler],
      ['payment_method.updated', paymentMethodHandler],
      ['customer.created', customerHandler],
      ['customer.updated', customerHandler],
      ['customer.deleted', customerHandler],
      ['mandate.updated', mandateHandler],
    ]);
  }

  /**
   * Called by the webhook controller on every incoming Stripe event.
   * Stores/updates the record in the DB then hands off to the async queue.
   * Returns immediately so Stripe receives a 200 before processing begins.
   */
  async processEvent(event: Stripe.Event): Promise<void> {
    const [existing] = await this.dataSource.query<StripeWebhookEvent[]>(
      `SELECT ${WEBHOOK_SELECT} FROM STRIPE_WEBHOOK_EVENTS WHERE STRIPE_EVENT_ID = :1 AND ROWNUM = 1`,
      [event.id],
    );

    if (existing?.status === 'processed') {
      this.logger.log({
        message: 'Skipping already processed event',
        eventId: event.id,
        eventType: event.type,
      });
      return;
    }

    let recordId: string;
    if (existing) {
      recordId = existing.id;
      await this.dataSource.query(
        `UPDATE STRIPE_WEBHOOK_EVENTS SET EVENT_TYPE = :1, PAYLOAD = :2, STATUS = :3, ERROR_MESSAGE = NULL, RETRY_COUNT = :4, PROCESSED_AT = NULL, UPDATED_AT = SYSDATE WHERE ID = :5`,
        [event.type, JSON.stringify(event), 'pending', 0, existing.id],
      );
    } else {
      recordId = randomUUID();
      await this.dataSource.query(
        `INSERT INTO STRIPE_WEBHOOK_EVENTS (ID, STRIPE_EVENT_ID, EVENT_TYPE, PAYLOAD, STATUS, RETRY_COUNT, CREATED_AT, UPDATED_AT)
         VALUES (:1, :2, :3, :4, :5, :6, SYSDATE, SYSDATE)`,
        [recordId, event.id, event.type, JSON.stringify(event), 'pending', 0],
      );
    }

    await this.webhookQueue.add(
      WEBHOOK_QUEUE,
      { eventId: event.id, recordId },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    );

    this.logger.log({
      message: 'Webhook event enqueued',
      eventId: event.id,
      eventType: event.type,
      recordId,
    });
  }

  /**
   * Called by WebhookProcessor for each dequeued job.
   * Reads the payload from the DB, dispatches to the appropriate handler,
   * then marks the record as processed or failed.
   */
  async execute(eventId: string, recordId: string): Promise<void> {
    const [row] = await this.dataSource.query<{ payload: string }[]>(
      `SELECT PAYLOAD AS "payload" FROM STRIPE_WEBHOOK_EVENTS WHERE ID = :1`,
      [recordId],
    );

    const event = JSON.parse(row.payload) as Stripe.Event;

    try {
      await this.dispatch(event);

      await this.dataSource.query(
        `UPDATE STRIPE_WEBHOOK_EVENTS SET STATUS = :1, PROCESSED_AT = SYSDATE, UPDATED_AT = SYSDATE WHERE ID = :2`,
        ['processed', recordId],
      );

      this.logger.log({
        message: 'Webhook event processed successfully',
        eventId,
        eventType: event.type,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await this.dataSource.query(
        `UPDATE STRIPE_WEBHOOK_EVENTS SET STATUS = :1, ERROR_MESSAGE = :2, RETRY_COUNT = RETRY_COUNT + 1, UPDATED_AT = SYSDATE WHERE ID = :3`,
        ['failed', errorMessage, recordId],
      );

      this.logger.error({
        message: 'Webhook event processing failed',
        eventId,
        eventType: event.type,
        error: errorMessage,
      });

      throw error; // BullMQ will retry based on job options
    }
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    const handler = this.handlerRegistry.get(event.type);
    if (!handler) {
      this.logger.warn({
        message: 'Unhandled webhook event type',
        eventType: event.type,
        eventId: event.id,
      });
      return;
    }
    await handler.handle(event);
  }
}
