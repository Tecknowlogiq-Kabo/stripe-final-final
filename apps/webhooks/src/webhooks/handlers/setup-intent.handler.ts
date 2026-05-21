import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { SetupIntentsService } from '../../setup-intents/setup-intents.service';;

@Injectable()
export class SetupIntentHandler {
  private readonly logger = new Logger(SetupIntentHandler.name);

  constructor(private readonly setupIntentsService: SetupIntentsService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const si = event.data.object as Stripe.SetupIntent;

    this.logger.log({
      message: `Handling ${event.type}`,
      stripeSetupIntentId: si.id,
      status: si.status,
    });

    switch (event.type) {
      case 'setup_intent.succeeded':
        await this.setupIntentsService.updateStatus(
          si.id,
          'succeeded',
          si.payment_method as string | undefined,
        );
        break;

      case 'setup_intent.setup_failed':
        await this.setupIntentsService.updateStatus(
          si.id,
          'requires_payment_method',
          undefined,
          si.last_setup_error ? JSON.stringify(si.last_setup_error) : undefined,
        );
        break;

      case 'setup_intent.canceled':
        await this.setupIntentsService.updateStatus(si.id, 'canceled');
        break;

      case 'setup_intent.requires_action':
        await this.setupIntentsService.updateStatus(si.id, 'requires_action');
        this.logger.log({
          message: 'SetupIntent requires action',
          stripeSetupIntentId: si.id,
          nextAction: si.next_action ? JSON.stringify(si.next_action) : undefined,
        });
        break;
    }
  }
}
