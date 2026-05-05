import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import {
  StripeWebhookEvent,
  WebhookEventStatus,
} from '../entities/stripe-webhook-event.entity';
import { PaymentIntentHandler } from './handlers/payment-intent.handler';
import { SetupIntentHandler } from './handlers/setup-intent.handler';
import { SubscriptionHandler } from './handlers/subscription.handler';
import { InvoiceHandler } from './handlers/invoice.handler';
import { PaymentMethodHandler } from './handlers/payment-method.handler';
import { CustomerHandler } from './handlers/customer.handler';
import { MandateHandler } from './handlers/mandate.handler';

const WEBHOOK_SELECT = `ID AS "id", STRIPE_EVENT_ID AS "stripeEventId", EVENT_TYPE AS "eventType", PAYLOAD AS "payload", STATUS AS "status", ERROR_MESSAGE AS "errorMessage", RETRY_COUNT AS "retryCount", PROCESSED_AT AS "processedAt", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly paymentIntentHandler: PaymentIntentHandler,
    private readonly setupIntentHandler: SetupIntentHandler,
    private readonly subscriptionHandler: SubscriptionHandler,
    private readonly invoiceHandler: InvoiceHandler,
    private readonly paymentMethodHandler: PaymentMethodHandler,
    private readonly customerHandler: CustomerHandler,
    private readonly mandateHandler: MandateHandler,
  ) {}

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

    try {
      await this.dispatch(event);

      await this.dataSource.query(
        `UPDATE STRIPE_WEBHOOK_EVENTS SET STATUS = :1, PROCESSED_AT = SYSDATE, UPDATED_AT = SYSDATE WHERE ID = :2`,
        ['processed', recordId],
      );

      this.logger.log({
        message: 'Webhook event processed successfully',
        eventId: event.id,
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
        eventId: event.id,
        eventType: event.type,
        retryCount: (existing?.retryCount ?? 0) + 1,
        error: errorMessage,
      });

      throw error;
    }
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
      case 'payment_intent.processing':
      case 'payment_intent.requires_action':
        return this.paymentIntentHandler.handle(event);

      case 'setup_intent.succeeded':
      case 'setup_intent.setup_failed':
      case 'setup_intent.canceled':
        return this.setupIntentHandler.handle(event);

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.trial_will_end':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        return this.subscriptionHandler.handle(event);

      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
      case 'invoice.upcoming':
      case 'invoice.created':
      case 'invoice.finalized':
        return this.invoiceHandler.handle(event);

      case 'payment_method.attached':
      case 'payment_method.detached':
      case 'payment_method.updated':
        return this.paymentMethodHandler.handle(event);

      case 'customer.created':
      case 'customer.updated':
      case 'customer.deleted':
        return this.customerHandler.handle(event);

      case 'mandate.updated':
        return this.mandateHandler.handle(event);

      default:
        this.logger.warn({
          message: 'Unhandled webhook event type',
          eventType: event.type,
          eventId: event.id,
        });
    }
  }
}
