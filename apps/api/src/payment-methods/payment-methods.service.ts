import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StripePaymentMethod } from '../entities/stripe-payment-method.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import Stripe from 'stripe';

@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(
    @InjectRepository(StripePaymentMethod)
    private readonly pmRepo: Repository<StripePaymentMethod>,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
  ) {}

  async listByCustomer(customerId: string): Promise<StripePaymentMethod[]> {
    await this.customersService.findById(customerId); // verify customer exists
    return this.pmRepo.find({
      where: { customer: { id: customerId } },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  async detach(id: string): Promise<void> {
    const pm = await this.pmRepo.findOne({ where: { id } });
    if (!pm) throw new NotFoundException(`PaymentMethod ${id} not found`);

    await this.stripeService.paymentMethods.detach(pm.stripePaymentMethodId);
    await this.pmRepo.remove(pm);
    this.logger.log({ message: 'PaymentMethod detached', paymentMethodId: id });
  }

  async setDefault(customerId: string, paymentMethodId: string): Promise<void> {
    const customer = await this.customersService.findById(customerId);
    const pm = await this.pmRepo.findOne({
      where: { id: paymentMethodId, customer: { id: customerId } },
    });
    if (!pm) throw new NotFoundException(`PaymentMethod ${paymentMethodId} not found`);

    // Update Stripe customer's default payment method
    await this.stripeService.customers.update(customer.stripeCustomerId, {
      invoice_settings: { default_payment_method: pm.stripePaymentMethodId },
    });

    // Update all PMs for this customer
    await this.pmRepo.update(
      { customer: { id: customerId } },
      { isDefault: false },
    );
    pm.isDefault = true;
    await this.pmRepo.save(pm);
  }

  async syncFromStripe(
    stripePaymentMethodId: string,
    customerId: string,
  ): Promise<StripePaymentMethod> {
    const customer = await this.customersService.findById(customerId);
    const stripePM = await this.stripeService.paymentMethods.retrieve(stripePaymentMethodId);

    let pm = await this.pmRepo.findOne({
      where: { stripePaymentMethodId },
    });

    if (!pm) {
      pm = this.pmRepo.create({ stripePaymentMethodId, customer });
    }

    pm.type = stripePM.type;
    if (stripePM.card) {
      pm.last4 = stripePM.card.last4;
      pm.brand = stripePM.card.brand;
      pm.expMonth = stripePM.card.exp_month;
      pm.expYear = stripePM.card.exp_year;
      pm.fingerprint = stripePM.card.fingerprint ?? undefined;
    }

    return this.pmRepo.save(pm);
  }

  async upsertFromStripeEvent(
    stripePM: Stripe.PaymentMethod,
    customerId?: string,
  ): Promise<void> {
    if (!stripePM.customer) return;

    let customer = null;
    try {
      customer = await this.customersService.findByStripeId(
        stripePM.customer as string,
      );
    } catch {
      return; // customer not in our DB
    }

    let pm = await this.pmRepo.findOne({
      where: { stripePaymentMethodId: stripePM.id },
    });

    if (!pm) {
      pm = this.pmRepo.create({
        stripePaymentMethodId: stripePM.id,
        customer,
      });
    }

    pm.type = stripePM.type;
    if (stripePM.card) {
      pm.last4 = stripePM.card.last4;
      pm.brand = stripePM.card.brand;
      pm.expMonth = stripePM.card.exp_month;
      pm.expYear = stripePM.card.exp_year;
      pm.fingerprint = stripePM.card.fingerprint ?? undefined;
    }

    await this.pmRepo.save(pm);
  }

  async removeByStripeId(stripePaymentMethodId: string): Promise<void> {
    const pm = await this.pmRepo.findOne({ where: { stripePaymentMethodId } });
    if (pm) await this.pmRepo.remove(pm);
  }
}
