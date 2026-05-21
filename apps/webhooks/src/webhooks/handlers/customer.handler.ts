import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { CustomersService } from '../../customers/customers.service';;

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
          this.logger.warn({
            message: 'Could not sync customer update — not in local DB',
            stripeCustomerId: customer.id,
          });
        }
        break;

      case 'customer.deleted':
        try {
          const localCustomer = await this.customersService.findByStripeId(customer.id);
          await this.customersService.syncSoftDelete(localCustomer.id);
          this.logger.log({
            message: 'Customer deleted — synced to local DB',
            stripeCustomerId: customer.id,
            localCustomerId: localCustomer.id,
          });
        } catch {
          // Customer not in our DB — nothing to do
        }
        break;

      case 'customer.discount.created': {
        const discount = event.data.object as Stripe.Discount;
        const coupon = discount.coupon as Stripe.Coupon;
        const customerId = typeof discount.customer === 'string'
          ? discount.customer
          : discount.customer?.id ?? 'unknown';
        this.logger.log({
          message: 'Customer discount created',
          stripeCustomerId: customerId,
          couponId: coupon.id,
          couponName: coupon.name,
          percentOff: coupon.percent_off,
          amountOff: coupon.amount_off,
          duration: coupon.duration,
        });
        break;
      }

      case 'customer.discount.deleted': {
        const discount = event.data.object as Stripe.Discount;
        const coupon = discount.coupon as Stripe.Coupon;
        const customerId = typeof discount.customer === 'string'
          ? discount.customer
          : discount.customer?.id ?? 'unknown';
        this.logger.log({
          message: 'Customer discount deleted',
          stripeCustomerId: customerId,
          couponId: coupon.id,
          couponName: coupon.name,
          percentOff: coupon.percent_off,
          amountOff: coupon.amount_off,
          duration: coupon.duration,
        });
        break;
      }
    }
  }
}
