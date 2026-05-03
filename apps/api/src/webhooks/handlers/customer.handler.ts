import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { CustomersService } from '../../customers/customers.service';

@Injectable()
export class CustomerHandler {
  private readonly logger = new Logger(CustomerHandler.name);

  constructor(private readonly customersService: CustomersService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const customer = event.data.object as Stripe.Customer;

    this.logger.log({
      message: `Handling ${event.type}`,
      stripeCustomerId: customer.id,
    });

    switch (event.type) {
      case 'customer.created':
        // Customer was created directly in Stripe (not via our API)
        // We can optionally sync it to our DB
        this.logger.log({
          message: 'Customer created in Stripe (possibly external)',
          stripeCustomerId: customer.id,
          email: customer.email,
        });
        break;

      case 'customer.updated':
        try {
          await this.customersService.syncFromStripe(customer.id);
        } catch {
          // Customer may not be in our DB (created externally)
          this.logger.warn({
            message: 'Could not sync customer update — not in local DB',
            stripeCustomerId: customer.id,
          });
        }
        break;

      case 'customer.deleted':
        try {
          const localCustomer = await this.customersService.findByStripeId(customer.id);
          // Mark as deleted locally
          localCustomer.isDeleted = true;
          // Note: using internal method directly since this is a sync operation
          this.logger.log({
            message: 'Customer deleted in Stripe, marking locally',
            stripeCustomerId: customer.id,
          });
        } catch {
          // Customer not in our DB — nothing to do
        }
        break;
    }
  }
}
