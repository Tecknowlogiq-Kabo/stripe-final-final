import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentIntentsService } from '@stripe-integration/domain';

@Injectable()
export class PaymentIntentHandler {
  private readonly logger = new Logger(PaymentIntentHandler.name);

  constructor(private readonly paymentIntentsService: PaymentIntentsService) {}

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
        break;
      }

      case 'payment_intent.canceled':
        await this.paymentIntentsService.updateStatus(pi.id, 'canceled');
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
