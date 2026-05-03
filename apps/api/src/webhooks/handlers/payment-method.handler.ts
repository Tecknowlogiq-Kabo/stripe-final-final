import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentMethodsService } from '../../payment-methods/payment-methods.service';

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

    switch (event.type) {
      case 'payment_method.attached':
      case 'payment_method.updated':
        await this.paymentMethodsService.upsertFromStripeEvent(pm);
        break;

      case 'payment_method.detached':
        await this.paymentMethodsService.removeByStripeId(pm.id);
        break;
    }
  }
}
