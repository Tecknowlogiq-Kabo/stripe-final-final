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

// ISO 3166-1 alpha-2 codes for payment methods that always originate
// from a single country.
const PM_TYPE_COUNTRY: Record<string, string> = {
  us_bank_account: 'US',
  bacs_debit: 'GB',
  au_becs_debit: 'AU',
  acss_debit: 'CA',
  ideal: 'NL',
  bancontact: 'BE',
  eps: 'AT',
};

@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(
    @InjectRepository(StripePaymentMethod)
    private readonly pmRepo: Repository<StripePaymentMethod>,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
  ) {}

  async listByCustomer(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: StripePaymentMethod[]; total: number; page: number; limit: number }> {
    await this.customersService.findById(customerId); // verify customer exists
    const [data, total] = await this.pmRepo.findAndCount({
      where: { customer: { id: customerId } },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
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

    let pm = await this.pmRepo.findOne({ where: { stripePaymentMethodId } });
    if (!pm) {
      pm = this.pmRepo.create({ stripePaymentMethodId, customer });
    }

    Object.assign(pm, this.extractPmFields(stripePM));
    return this.pmRepo.save(pm);
  }

  /**
   * Syncs a payment method from Stripe using only its Stripe PM ID.
   * Looks up the customer from the PM's attached customer field.
   * Used by the MandateHandler to re-sync a PM after a mandate event.
   */
  async syncFromStripeById(stripePaymentMethodId: string): Promise<void> {
    const stripePM = await this.stripeService.paymentMethods.retrieve(stripePaymentMethodId);
    if (!stripePM.customer) return;
    await this.upsertFromStripeEvent(stripePM);
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

    Object.assign(pm, this.extractPmFields(stripePM));
    await this.pmRepo.save(pm);
  }

  async removeByStripeId(stripePaymentMethodId: string): Promise<void> {
    const pm = await this.pmRepo.findOne({ where: { stripePaymentMethodId } });
    if (pm) await this.pmRepo.remove(pm);
  }

  /**
   * Extracts all relevant fields from a Stripe PaymentMethod object and maps
   * them to entity column values. Handles every payment method type:
   * - Card fields stay in dedicated columns for query efficiency
   * - Type-specific sub-objects (sepa_debit, us_bank_account, ideal, etc.)
   *   are stored as JSON in the `details` CLOB column
   * - billing_details stored as JSON in `billingDetails` CLOB column
   */
  private extractPmFields(stripePM: Stripe.PaymentMethod): Partial<StripePaymentMethod> {
    // Dynamically access the type-specific sub-object (e.g. stripePM.sepa_debit)
    const typeObj = (stripePM as unknown as Record<string, unknown>)[stripePM.type];

    // Derive country: type-specific source → billing address fallback
    const country: string | undefined =
      stripePM.card?.country ??
      (stripePM.sepa_debit as { country?: string } | undefined)?.country ??
      PM_TYPE_COUNTRY[stripePM.type] ??
      (stripePM.billing_details?.address?.country ?? undefined) ??
      undefined;

    return {
      type: stripePM.type,
      // Card columns — populated for card/card_present only
      ...(stripePM.card && {
        last4: stripePM.card.last4,
        brand: stripePM.card.brand,
        expMonth: stripePM.card.exp_month,
        expYear: stripePM.card.exp_year,
        fingerprint: stripePM.card.fingerprint ?? undefined,
        cardWalletType: stripePM.card.wallet?.type ?? undefined,
        funding: stripePM.card.funding ?? undefined,
      }),
      // Generic columns — populated for all types
      details: typeObj != null ? JSON.stringify(typeObj) : undefined,
      billingDetails: stripePM.billing_details
        ? JSON.stringify(stripePM.billing_details)
        : undefined,
      country,
    };
  }
}
