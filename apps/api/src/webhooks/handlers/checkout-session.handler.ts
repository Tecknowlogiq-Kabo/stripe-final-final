import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { TrustService } from '../../trust/trust.service';

/**
 * Handles Stripe Checkout Session webhooks.
 *
 * When a checkout.session.completed event fires with a trustId in metadata,
 * the associated trust token is automatically approved — triggering S3 pull
 * if the resource type is 'file'.
 */
@Injectable()
export class CheckoutSessionHandler {
  private readonly logger = new Logger(CheckoutSessionHandler.name);

  constructor(private readonly trustService: TrustService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;

    this.logger.log({
      message: `Handling ${event.type}`,
      checkoutSessionId: session.id,
      paymentStatus: session.payment_status,
    });

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCompleted(session);
        break;

      case 'checkout.session.async_payment_succeeded':
        await this.handleCompleted(session);
        break;

      case 'checkout.session.expired':
        this.logger.log({
          message: 'Checkout session expired',
          checkoutSessionId: session.id,
        });
        break;
    }
  }

  private async handleCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const trustId = session.metadata?.trustId;

    if (!trustId) {
      this.logger.log({
        message: 'Checkout session completed — no trustId in metadata',
        checkoutSessionId: session.id,
      });
      return;
    }

    this.logger.log({
      message: 'Checkout session completed — auto-approving trustId',
      checkoutSessionId: session.id,
      trustId: trustId.substring(0, 20) + '...',
    });

    const approved = await this.trustService.approve(trustId);
    if (approved) {
      this.logger.log({
        message: 'TrustId auto-approved via checkout webhook',
        checkoutSessionId: session.id,
        trustId: trustId.substring(0, 20) + '...',
      });
    } else {
      this.logger.warn({
        message: 'TrustId auto-approval failed — token may be expired or already acted upon',
        checkoutSessionId: session.id,
        trustId: trustId.substring(0, 20) + '...',
      });
    }
  }
}
