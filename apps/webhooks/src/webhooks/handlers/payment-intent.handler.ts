import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentIntentsService } from '../../payment-intents/payment-intents.service';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class PaymentIntentHandler {
  private readonly logger = new Logger(PaymentIntentHandler.name);

  constructor(
    private readonly paymentIntentsService: PaymentIntentsService,
    private readonly auditService: AuditService,
  ) {}

  async handle(event: Stripe.Event): Promise<void> {
    const pi = event.data.object as Stripe.PaymentIntent;

    this.logger.log({
      message: `Handling ${event.type}`,
      stripePaymentIntentId: pi.id,
      status: pi.status,
    });

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.paymentIntentsService.updateStatus(pi.id, 'succeeded');
        await this.auditService.log({
          actorId: 'system:webhook',
          actorEmail: null,
          action: 'payment_intent.succeeded',
          resourceType: 'payment_intent',
          resourceId: pi.id,
          details: JSON.stringify({ amount: pi.amount, currency: pi.currency }),
          status: 'success',
        });
        break;

      case 'payment_intent.payment_failed': {
        const lastError = pi.last_payment_error;
        await this.paymentIntentsService.updateStatus(
          pi.id,
          'requires_payment_method',
          lastError?.code ?? undefined,
          lastError?.decline_code ?? undefined,
          lastError?.message ?? undefined,
        );
        await this.auditService.log({
          actorId: 'system:webhook',
          actorEmail: null,
          action: 'payment_intent.payment_failed',
          resourceType: 'payment_intent',
          resourceId: pi.id,
          details: JSON.stringify({ errorCode: lastError?.code, declineCode: lastError?.decline_code, message: lastError?.message }),
          status: 'failure',
        });
        break;
      }

      case 'payment_intent.canceled':
        await this.paymentIntentsService.updateStatus(pi.id, 'canceled');
        await this.auditService.log({
          actorId: 'system:webhook',
          actorEmail: null,
          action: 'payment_intent.canceled',
          resourceType: 'payment_intent',
          resourceId: pi.id,
          details: JSON.stringify({ cancellationReason: pi.cancellation_reason }),
          status: 'failure',
        });
        break;

      case 'payment_intent.processing':
        await this.paymentIntentsService.updateStatus(
          pi.id,
          'processing',
          undefined,
          undefined,
          undefined,
          pi.next_action ? JSON.stringify(pi.next_action) : undefined,
          pi.amount_received,
        );
        break;

      case 'payment_intent.requires_action':
        await this.paymentIntentsService.updateStatus(pi.id, 'requires_action');
        break;

      case 'payment_intent.amount_capturable_updated':
        this.logger.log({
          message: 'PaymentIntent amount capturable updated',
          stripePaymentIntentId: pi.id,
          amountCapturable: pi.amount_capturable,
        });
        break;
    }
  }
}
