import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { SetupIntentsService } from '../../setup-intents/setup-intents.service';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class SetupIntentHandler {
  private readonly logger = new Logger(SetupIntentHandler.name);

  constructor(
    private readonly setupIntentsService: SetupIntentsService,
    private readonly auditService: AuditService,
  ) {}

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
        await this.auditService.log({
          actorId: 'system:webhook',
          actorEmail: null,
          action: 'setup_intent.succeeded',
          resourceType: 'setup_intent',
          resourceId: si.id,
          details: JSON.stringify({ paymentMethod: si.payment_method, customer: si.customer }),
          status: 'success',
        });
        break;

      case 'setup_intent.setup_failed':
        await this.setupIntentsService.updateStatus(
          si.id,
          'requires_payment_method',
          undefined,
          si.last_setup_error ? JSON.stringify(si.last_setup_error) : undefined,
        );
        await this.auditService.log({
          actorId: 'system:webhook',
          actorEmail: null,
          action: 'setup_intent.setup_failed',
          resourceType: 'setup_intent',
          resourceId: si.id,
          details: JSON.stringify({ error: si.last_setup_error }),
          status: 'failure',
        });
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
