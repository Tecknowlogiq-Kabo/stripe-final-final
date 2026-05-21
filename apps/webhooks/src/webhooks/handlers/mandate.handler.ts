import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentMethodsService } from '@stripe-integration/domain';

@Injectable()
export class MandateHandler {
  private readonly logger = new Logger(MandateHandler.name);

  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const mandate = event.data.object as Stripe.Mandate;
    const pmId =
      typeof mandate.payment_method === 'string'
        ? mandate.payment_method
        : (mandate.payment_method as Stripe.PaymentMethod).id;

    this.logger.log({
      message: `Handling ${event.type}`,
      mandateId: mandate.id,
      status: mandate.status,
      paymentMethodId: pmId,
    });

    await this.paymentMethodsService.syncFromStripeById(pmId);
  }
}
