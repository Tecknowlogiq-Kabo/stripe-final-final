import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

@Injectable()
export class InvoiceHandler {
  private readonly logger = new Logger(InvoiceHandler.name);

  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;

    this.logger.log({
      message: `Handling ${event.type}`,
      stripeInvoiceId: invoice.id,
      subscriptionId: invoice.subscription,
    });

    switch (event.type) {
      case 'invoice.created':
        this.logger.log({
          message: 'Invoice created',
          stripeInvoiceId: invoice.id,
          stripeCustomerId: invoice.customer,
          stripeSubscriptionId: invoice.subscription,
          amountDue: invoice.amount_due,
          currency: invoice.currency,
          status: invoice.status,
        });
        break;

      case 'invoice.finalized':
        this.logger.log({
          message: 'Invoice finalized',
          stripeInvoiceId: invoice.id,
          stripeCustomerId: invoice.customer,
          stripeSubscriptionId: invoice.subscription,
          amountDue: invoice.amount_due,
          currency: invoice.currency,
        });
        break;

      case 'invoice.payment_succeeded':
        if (invoice.subscription) {
          // Subscription payment succeeded — sync subscription status
          const sub = await this.subscriptionsService.findByStripeId(
            invoice.subscription as string,
          );
          if (sub) {
            sub.status = 'active';
            // The subscription service will handle the full sync on next subscription event
          }
          this.logger.log({
            message: 'Invoice payment succeeded for subscription',
            stripeSubscriptionId: invoice.subscription,
            amount: invoice.amount_paid,
            currency: invoice.currency,
          });
        }
        break;

      case 'invoice.payment_failed':
        if (invoice.subscription) {
          this.logger.warn({
            message: 'Invoice payment failed for subscription — updating status to past_due',
            stripeSubscriptionId: invoice.subscription,
            attemptCount: invoice.attempt_count,
            nextPaymentAttempt: invoice.next_payment_attempt,
          });

          // Update status immediately so the UI reflects the failure.
          // The customer.subscription.updated webhook will follow, but may be delayed.
          try {
            const sub = await this.subscriptionsService.findByStripeId(
              invoice.subscription as string,
            );
            if (sub && sub.status === 'active') {
              await this.subscriptionsService.setStatus(sub.id, 'past_due');
              this.logger.log({
                message: 'Subscription marked past_due due to payment failure',
                subscriptionId: sub.id,
                stripeSubscriptionId: invoice.subscription,
              });
            }
          } catch (err) {
            this.logger.error({
              message: 'Failed to update subscription status on payment failure',
              stripeSubscriptionId: invoice.subscription,
              err,
            });
          }
        }
        break;

      case 'invoice.upcoming':
        this.logger.log({
          message: 'Upcoming invoice notification',
          stripeCustomerId: invoice.customer,
          amountDue: invoice.amount_due,
          dueDate: invoice.due_date,
        });
        break;

      case 'invoice.paid':
        this.logger.log({
          message: 'Invoice paid',
          stripeInvoiceId: invoice.id,
          stripeCustomerId: invoice.customer,
          stripeSubscriptionId: invoice.subscription,
          amountPaid: invoice.amount_paid,
          currency: invoice.currency,
          paidOutOfBand: invoice.paid_out_of_band,
        });
        if (invoice.subscription) {
          try {
            const sub = await this.subscriptionsService.findByStripeId(
              invoice.subscription as string,
            );
            if (sub && sub.status === 'past_due') {
              await this.subscriptionsService.setStatus(sub.id, 'active');
              this.logger.log({
                message: 'Subscription reactivated after invoice paid',
                subscriptionId: sub.id,
                stripeSubscriptionId: invoice.subscription,
              });
            }
          } catch (err) {
            this.logger.error({
              message: 'Failed to reactivate subscription on invoice paid',
              stripeSubscriptionId: invoice.subscription,
              err,
            });
          }
        }
        break;

      case 'invoice.voided':
        this.logger.log({
          message: 'Invoice voided',
          stripeInvoiceId: invoice.id,
          stripeCustomerId: invoice.customer,
          stripeSubscriptionId: invoice.subscription,
          reason: (invoice as unknown as Record<string, unknown>).void_reason ?? 'unknown',
        });
        break;

      case 'invoice.marked_uncollectible':
        this.logger.warn({
          message: 'Invoice marked uncollectible',
          stripeInvoiceId: invoice.id,
          stripeCustomerId: invoice.customer,
          stripeSubscriptionId: invoice.subscription,
          amountDue: invoice.amount_due,
        });
        if (invoice.subscription) {
          try {
            const sub = await this.subscriptionsService.findByStripeId(
              invoice.subscription as string,
            );
            if (sub && (sub.status === 'past_due' || sub.status === 'active')) {
              await this.subscriptionsService.setStatus(sub.id, 'unpaid');
              this.logger.log({
                message: 'Subscription marked unpaid due to uncollectible invoice',
                subscriptionId: sub.id,
                stripeSubscriptionId: invoice.subscription,
              });
            }
          } catch (err) {
            this.logger.error({
              message: 'Failed to update subscription on invoice uncollectible',
              stripeSubscriptionId: invoice.subscription,
              err,
            });
          }
        }
        break;
    }
  }
}
