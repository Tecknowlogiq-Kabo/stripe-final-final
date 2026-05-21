import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { StripePaymentMethod } from '../entities/stripe-payment-method.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import Stripe from 'stripe';
import { PaymentMethodsRepository } from './payment-methods.repository';

@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(
    private readonly repo: PaymentMethodsRepository,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
  ) {}

  async findById(id: string): Promise<StripePaymentMethod> {
    const pm = await this.repo.findById(id);
    if (!pm) throw new NotFoundException(`PaymentMethod ${id} not found`);
    return pm;
  }

  async listByCustomer(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: StripePaymentMethod[]; total: number; page: number; limit: number }> {
    await this.customersService.findById(customerId);

    const offset = (page - 1) * limit;
    const { data, total } = await this.repo.listByCustomer(customerId, offset, limit);

    return { data, total, page, limit };
  }

  async detach(id: string): Promise<void> {
    const pm = await this.repo.findById(id);
    if (!pm) throw new NotFoundException(`PaymentMethod ${id} not found`);

    await this.stripeService.paymentMethods.detach(pm.stripePaymentMethodId);
    await this.repo.deleteById(id);
    this.logger.log({ message: 'PaymentMethod detached', paymentMethodId: id });
  }

  async setDefault(customerId: string, paymentMethodId: string): Promise<void> {
    await this.customersService.findById(customerId);
    const pm = await this.repo.findByIdAndCustomer(paymentMethodId, customerId);
    if (!pm) throw new NotFoundException(`PaymentMethod ${paymentMethodId} not found`);

    const customer = await this.customersService.findById(customerId);
    await this.stripeService.customers.update(customer.stripeCustomerId, {
      invoice_settings: { default_payment_method: pm.stripePaymentMethodId },
    });

    await this.repo.clearDefaultByCustomer(customerId);
    await this.repo.setDefault(paymentMethodId);
  }

  async syncFromStripe(
    stripePaymentMethodId: string,
    customerId: string,
  ): Promise<StripePaymentMethod> {
    const customer = await this.customersService.findById(customerId);
    const stripePM = await this.stripeService.paymentMethods.retrieve(stripePaymentMethodId);

    const existing = await this.repo.findByStripeId(stripePaymentMethodId);
    const fields = this.extractPmFields(stripePM);

    if (existing) {
      await this.repo.updateFields(existing.id, fields);
      const updated = await this.repo.findById(existing.id);
      return updated!;
    }

    return this.repo.insertNew(stripePaymentMethodId, customer.id, fields);
  }

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

    let customer: StripeCustomer | null = null;
    try {
      customer = await this.customersService.findByStripeId(
        stripePM.customer as string,
      );
    } catch {
      return;
    }

    if (!customer) return;

    const fields = this.extractPmFields(stripePM);
    await this.repo.upsertFromStripeEvent(stripePM.id, customer.id, fields);
  }

  async removeByStripeId(stripePaymentMethodId: string): Promise<void> {
    const pm = await this.repo.findByStripeId(stripePaymentMethodId);
    if (pm) {
      await this.repo.deleteById(pm.id);
    }
  }

  private extractPmFields(stripePM: Stripe.PaymentMethod): { type: string } & Partial<Omit<StripePaymentMethod, 'type'>> {
    const typeObj = (stripePM as unknown as Record<string, unknown>)[stripePM.type];

    // Inline country resolution: prefer card/sepa country, fall back to type-specific defaults
    const PM_TYPE_COUNTRY: Record<string, string> = {
      us_bank_account: 'US', bacs_debit: 'GB', au_becs_debit: 'AU',
      acss_debit: 'CA', ideal: 'NL', bancontact: 'BE', eps: 'AT',
    };
    const country: string | undefined =
      stripePM.card?.country ??
      (stripePM.sepa_debit as { country?: string } | undefined)?.country ??
      PM_TYPE_COUNTRY[stripePM.type] ??
      (stripePM.billing_details?.address?.country ?? undefined) ??
      undefined;

    return {
      type: stripePM.type,
      ...(stripePM.card && {
        last4: stripePM.card.last4,
        brand: stripePM.card.brand,
        expMonth: stripePM.card.exp_month,
        expYear: stripePM.card.exp_year,
        fingerprint: stripePM.card.fingerprint ?? undefined,
        cardWalletType: stripePM.card.wallet?.type ?? undefined,
        funding: stripePM.card.funding ?? undefined,
      }),
      details: typeObj != null ? JSON.stringify(typeObj) : undefined,
      billingDetails: stripePM.billing_details
        ? JSON.stringify(stripePM.billing_details)
        : undefined,
      country,
    };
  }
}
