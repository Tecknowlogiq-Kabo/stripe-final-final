import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentMethodsService } from '../../payment-methods/payment-methods.service';;

@Injectable()
export class PaymentMethodHandler {
  private readonly logger = new Logger(PaymentMethodHandler.name);

  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const pm = event.data.object as Stripe.PaymentMethod;

    this.logger.log({
      message: `Handling ${event.type}`,
      stripePaymentMethodId: pm.id,
      type: pm.type,
    });

    const type = event.type as string;

    if (type === 'payment_method.attached' || type === 'payment_method.updated') {
      await this.paymentMethodsService.upsertFromStripeEvent(pm);
    } else if (type === 'payment_method.detached') {
      await this.paymentMethodsService.removeByStripeId(pm.id);
    } else if (type === 'payment_method.card_automatically_updated') {
      await this.paymentMethodsService.upsertFromStripeEvent(pm);
      const dataWithPrev = event.data as { previous_attributes?: Record<string, unknown> };
      this.logger.log({
        message: 'Card automatically updated (card account updater)',
        stripePaymentMethodId: pm.id,
        previousAttributes: dataWithPrev.previous_attributes
          ? JSON.stringify(dataWithPrev.previous_attributes)
          : undefined,
      });
    }
  }
}
