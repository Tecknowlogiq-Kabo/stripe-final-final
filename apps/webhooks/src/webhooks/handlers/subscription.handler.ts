import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';;

@Injectable()
export class SubscriptionHandler {
  private readonly logger = new Logger(SubscriptionHandler.name);

  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    this.logger.log({
      message: `Handling ${event.type}`,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
    });

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await this.subscriptionsService.syncFromStripeEvent(subscription);
        break;

      case 'customer.subscription.trial_will_end':
        await this.subscriptionsService.syncFromStripeEvent(subscription);
        this.logger.log({
          message: 'Subscription trial ending soon — consider sending notification',
          stripeSubscriptionId: subscription.id,
          trialEnd: subscription.trial_end,
        });
        break;

      case 'customer.subscription.pending_update_applied':
        await this.subscriptionsService.syncFromStripeEvent(subscription);
        this.logger.log({
          message: 'Pending subscription update applied',
          stripeSubscriptionId: subscription.id,
          currentPeriodEnd: subscription.current_period_end,
        });
        break;

      case 'customer.subscription.pending_update_expired':
        this.logger.log({
          message: 'Pending subscription update expired',
          stripeSubscriptionId: subscription.id,
          pendingUpdate: subscription.pending_update
            ? JSON.stringify(subscription.pending_update)
            : undefined,
        });
        break;
    }
  }
}
