import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import Stripe from 'stripe';
import { PaymentIntentHandler } from './handlers/payment-intent.handler';
import { SetupIntentHandler } from './handlers/setup-intent.handler';
import { SubscriptionHandler } from './handlers/subscription.handler';
import { InvoiceHandler } from './handlers/invoice.handler';
import { PaymentMethodHandler } from './handlers/payment-method.handler';
import { CustomerHandler } from './handlers/customer.handler';
import { MandateHandler } from './handlers/mandate.handler';
import { ChargeHandler } from './handlers/charge.handler';
import { RadarHandler } from './handlers/radar.handler';
import { AccountHandler } from './handlers/account.handler';
import { WEBHOOK_QUEUE } from './webhook-queue.constants';
import { WebhooksRepository } from './webhooks.repository';
import { EncryptionService } from '../crypto/encryption.service';

type WebhookHandler = { handle: (event: Stripe.Event) => Promise<void> };

/**
 * Webhook intake, storage, queuing, dispatch, and lifecycle management.
 *
 * Every public method is wrapped in an OTel span so the full webhook
 * pipeline (Stripe → receive → DB insert → BullMQ enqueue → worker
 * dequeue → decrypt → dispatch → handler → DB commit) is visible as a
 * connected trace in Tempo.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly handlerRegistry: Map<string, WebhookHandler>;
  private readonly tracer = trace.getTracer('stripe-webhooks');

  constructor(
    private readonly repo: WebhooksRepository,
    @InjectQueue(WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
    private readonly paymentIntentHandler: PaymentIntentHandler,
    private readonly setupIntentHandler: SetupIntentHandler,
    private readonly subscriptionHandler: SubscriptionHandler,
    private readonly invoiceHandler: InvoiceHandler,
    private readonly paymentMethodHandler: PaymentMethodHandler,
    private readonly customerHandler: CustomerHandler,
    private readonly mandateHandler: MandateHandler,
    private readonly chargeHandler: ChargeHandler,
    private readonly radarHandler: RadarHandler,
    private readonly accountHandler: AccountHandler,
    private readonly encryption: EncryptionService,
  ) {
    this.handlerRegistry = new Map<string, WebhookHandler>([
      ['payment_intent.succeeded', paymentIntentHandler],
      ['payment_intent.payment_failed', paymentIntentHandler],
      ['payment_intent.canceled', paymentIntentHandler],
      ['payment_intent.processing', paymentIntentHandler],
      ['payment_intent.requires_action', paymentIntentHandler],
      ['payment_intent.amount_capturable_updated', paymentIntentHandler],
      ['setup_intent.succeeded', setupIntentHandler],
      ['setup_intent.setup_failed', setupIntentHandler],
      ['setup_intent.canceled', setupIntentHandler],
      ['setup_intent.requires_action', setupIntentHandler],
      ['customer.subscription.created', subscriptionHandler],
      ['customer.subscription.updated', subscriptionHandler],
      ['customer.subscription.deleted', subscriptionHandler],
      ['customer.subscription.trial_will_end', subscriptionHandler],
      ['customer.subscription.paused', subscriptionHandler],
      ['customer.subscription.resumed', subscriptionHandler],
      ['customer.subscription.pending_update_applied', subscriptionHandler],
      ['customer.subscription.pending_update_expired', subscriptionHandler],
      ['invoice.payment_succeeded', invoiceHandler],
      ['invoice.payment_failed', invoiceHandler],
      ['invoice.upcoming', invoiceHandler],
      ['invoice.created', invoiceHandler],
      ['invoice.finalized', invoiceHandler],
      ['invoice.paid', invoiceHandler],
      ['invoice.voided', invoiceHandler],
      ['invoice.marked_uncollectible', invoiceHandler],
      ['payment_method.attached', paymentMethodHandler],
      ['payment_method.detached', paymentMethodHandler],
      ['payment_method.updated', paymentMethodHandler],
      ['payment_method.card_automatically_updated', paymentMethodHandler],
      ['customer.created', customerHandler],
      ['customer.updated', customerHandler],
      ['customer.deleted', customerHandler],
      ['customer.discount.created', customerHandler],
      ['customer.discount.deleted', customerHandler],
      ['mandate.updated', mandateHandler],
      ['charge.succeeded', chargeHandler],
      ['charge.failed', chargeHandler],
      ['charge.refunded', chargeHandler],
      ['charge.dispute.created', chargeHandler],
      ['charge.dispute.closed', chargeHandler],
      ['charge.dispute.updated', chargeHandler],
      ['radar.early_fraud_warning', radarHandler],
      ['account.updated', accountHandler],
    ]);
  }

  /**
   * Incoming Stripe webhook — store payload, enqueue for async processing.
   * Returns immediately so Stripe receives 200 before processing begins.
   */
  async processEvent(event: Stripe.Event): Promise<void> {
    const span = this.tracer.startSpan('webhooks.processEvent', {
      attributes: { 'stripe.event.type': event.type, 'stripe.event.id': event.id },
    });
    try {
      const existing = await this.repo.findByStripeEventId(event.id);

      if (existing?.status === 'processed') {
        this.logger.log({ message: 'Skipping already processed event', eventId: event.id, eventType: event.type });
        span.setStatus({ code: SpanStatusCode.OK });
        return;
      }

      const serialized = JSON.stringify(event);
      const encrypted = this.encryption.encrypt(serialized);

      let recordId: string;
      if (existing) {
        recordId = existing.id;
        await this.repo.updateForRetry(existing.id, event.type, encrypted);
      } else {
        recordId = randomUUID();
        await this.repo.insert(recordId, event.id, event.type, encrypted);
      }

      await this.webhookQueue.add(WEBHOOK_QUEUE, { eventId: event.id, recordId });

      span.setAttribute('webhook.record_id', recordId);
      span.setStatus({ code: SpanStatusCode.OK });
      this.logger.log({ message: 'Webhook event enqueued', eventId: event.id, eventType: event.type, recordId });
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * Called by WebhookProcessor for each dequeued job.
   * Decrypts payload, dispatches to handler, marks record processed/failed.
   */
  async execute(eventId: string, recordId: string): Promise<void> {
    const span = this.tracer.startSpan('webhooks.execute', {
      attributes: { 'stripe.event.id': eventId, 'webhook.record_id': recordId },
    });
    try {
      const encryptedPayload = await this.repo.getPayload(recordId);
      const decryptedPayload = this.encryption.decrypt(encryptedPayload);
      const event = JSON.parse(decryptedPayload) as Stripe.Event;

      span.setAttribute('stripe.event.type', event.type);
      await this.dispatch(event);

      await this.repo.markProcessed(recordId);
      span.setStatus({ code: SpanStatusCode.OK });
      this.logger.log({ message: 'Webhook event processed successfully', eventId, eventType: event.type });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await this.repo.markFailed(recordId, errMsg);
      span.setStatus({ code: SpanStatusCode.ERROR, message: errMsg });
      span.recordException(error instanceof Error ? error : new Error(errMsg));
      this.logger.error({ message: 'Webhook event processing failed', eventId, error: errMsg });
      throw error;
    } finally {
      span.end();
    }
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    const handler = this.handlerRegistry.get(event.type);
    if (!handler) {
      this.logger.warn({ message: 'Unhandled webhook event type', eventType: event.type, eventId: event.id });
      return;
    }
    // Handler spans are created by the StripeService proxy (Stripe API calls)
    // and the underlying services/repositories they call.
    await handler.handle(event);
  }
}
