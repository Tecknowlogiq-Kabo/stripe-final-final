import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(StripeWebhookEvent)
    private readonly webhookEventRepo: Repository<StripeWebhookEvent>,
    private readonly paymentIntentHandler: PaymentIntentHandler,
    private readonly setupIntentHandler: SetupIntentHandler,
    private readonly subscriptionHandler: SubscriptionHandler,
    private readonly invoiceHandler: InvoiceHandler,
    private readonly paymentMethodHandler: PaymentMethodHandler,
    private readonly customerHandler: CustomerHandler,
  ) {}

  async processEvent(event: Stripe.Event): Promise<void> {
    // Idempotency: check if already processed successfully
    const existing = await this.webhookEventRepo.findOne({
      where: { stripeEventId: event.id },
    });

    if (existing?.status === 'processed') {
      this.logger.log({
        message: 'Skipping already processed event',
        eventId: event.id,
        eventType: event.type,
      });
      return;
    }

    // Upsert the event record (create or update existing pending/failed)
    const record: StripeWebhookEvent = existing ?? this.webhookEventRepo.create({
      stripeEventId: event.id,
      eventType: event.type,
      payload: JSON.stringify(event),
      status: 'pending' as WebhookEventStatus,
      retryCount: 0,
    });

    await this.webhookEventRepo.save(record);

    try {
      await this.dispatch(event);

      record.status = 'processed';
      record.processedAt = new Date();
      await this.webhookEventRepo.save(record);

      this.logger.log({
        message: 'Webhook event processed successfully',
        eventId: event.id,
        eventType: event.type,
      });
    } catch (error) {
      record.status = 'failed';
      record.errorMessage =
        error instanceof Error ? error.message : String(error);
      record.retryCount = (record.retryCount ?? 0) + 1;
      await this.webhookEventRepo.save(record);

      this.logger.error({
        message: 'Webhook event processing failed',
        eventId: event.id,
        eventType: event.type,
        retryCount: record.retryCount,
        error: record.errorMessage,
      });

      // Re-throw so NestJS returns 5xx, causing Stripe to retry with backoff
      throw error;
    }
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      // Payment Intent events
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
      case 'payment_intent.processing':
      case 'payment_intent.requires_action':
        return this.paymentIntentHandler.handle(event);

      // Setup Intent events
      case 'setup_intent.succeeded':
      case 'setup_intent.setup_failed':
      case 'setup_intent.canceled':
        return this.setupIntentHandler.handle(event);

      // Subscription lifecycle events
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.trial_will_end':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        return this.subscriptionHandler.handle(event);

      // Invoice events
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
      case 'invoice.upcoming':
      case 'invoice.created':
      case 'invoice.finalized':
        return this.invoiceHandler.handle(event);

      // Payment method events
      case 'payment_method.attached':
      case 'payment_method.detached':
      case 'payment_method.updated':
        return this.paymentMethodHandler.handle(event);

      // Customer events
      case 'customer.created':
      case 'customer.updated':
      case 'customer.deleted':
        return this.customerHandler.handle(event);

      default:
        this.logger.warn({
          message: 'Unhandled webhook event type',
          eventType: event.type,
          eventId: event.id,
        });
    }
  }
}
