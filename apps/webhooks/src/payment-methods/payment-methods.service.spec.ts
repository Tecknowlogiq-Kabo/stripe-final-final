import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsRepository } from './payment-methods.repository';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { StripeCustomer } from '../entities/stripe-customer.entity';

interface MockRepo {
  findByStripeId: jest.Mock;
  upsertFromStripeEvent: jest.Mock;
  deleteById: jest.Mock;
}
interface MockCustomersService {
  findByStripeId: jest.Mock;
}
interface MockStripeService {
  paymentMethods: { retrieve: jest.Mock };
}

const makePm = (overrides: Partial<Stripe.PaymentMethod> = {}): Stripe.PaymentMethod =>
  ({
    id: 'pm_1',
    type: 'card',
    customer: 'cus_stripe_1',
    card: {
      last4: '4242',
      brand: 'visa',
      exp_month: 12,
      exp_year: 2030,
      fingerprint: 'fp',
      country: 'US',
      funding: 'credit',
      wallet: null,
    },
    billing_details: { address: { country: 'US' } },
    ...overrides,
  } as unknown as Stripe.PaymentMethod);

describe('PaymentMethodsService (webhook paths)', () => {
  let service: PaymentMethodsService;
  let repo: MockRepo;
  let customers: MockCustomersService;
  let stripe: MockStripeService;

  beforeEach(async () => {
    repo = {
      findByStripeId: jest.fn(),
      upsertFromStripeEvent: jest.fn().mockResolvedValue(undefined),
      deleteById: jest.fn().mockResolvedValue(undefined),
    };
    customers = { findByStripeId: jest.fn() };
    stripe = { paymentMethods: { retrieve: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodsService,
        { provide: PaymentMethodsRepository, useValue: repo },
        { provide: StripeService, useValue: stripe },
        { provide: CustomersService, useValue: customers },
      ],
    }).compile();

    service = module.get(PaymentMethodsService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('upsertFromStripeEvent', () => {
    it('skips when payment method has no customer', async () => {
      await service.upsertFromStripeEvent(makePm({ customer: null }));
      expect(customers.findByStripeId).not.toHaveBeenCalled();
      expect(repo.upsertFromStripeEvent).not.toHaveBeenCalled();
    });

    it('looks up customer and upserts when customer exists', async () => {
      const customer: Partial<StripeCustomer> = { id: 'cust-uuid', stripeCustomerId: 'cus_stripe_1' };
      customers.findByStripeId.mockResolvedValue(customer);

      await service.upsertFromStripeEvent(makePm());

      expect(customers.findByStripeId).toHaveBeenCalledWith('cus_stripe_1');
      expect(repo.upsertFromStripeEvent).toHaveBeenCalledWith(
        'pm_1',
        'cust-uuid',
        expect.objectContaining({
          type: 'card',
          last4: '4242',
          brand: 'visa',
          expMonth: 12,
          expYear: 2030,
          country: 'US',
        }),
      );
    });

    it('throws when customer not found yet (so BullMQ retries the job)', async () => {
      customers.findByStripeId.mockRejectedValue(new NotFoundException('not found'));
      await expect(service.upsertFromStripeEvent(makePm())).rejects.toThrow(NotFoundException);
      expect(repo.upsertFromStripeEvent).not.toHaveBeenCalled();
    });

    it('extracts non-card payment methods (e.g. us_bank_account) with fallback country', async () => {
      const customer: Partial<StripeCustomer> = { id: 'cust-uuid', stripeCustomerId: 'cus_stripe_1' };
      customers.findByStripeId.mockResolvedValue(customer);

      const bankPm = {
        id: 'pm_bank',
        type: 'us_bank_account',
        customer: 'cus_stripe_1',
        us_bank_account: { last4: '6789' },
        billing_details: null,
      } as unknown as Stripe.PaymentMethod;
      await service.upsertFromStripeEvent(bankPm);

      expect(repo.upsertFromStripeEvent).toHaveBeenCalledWith(
        'pm_bank',
        'cust-uuid',
        expect.objectContaining({ type: 'us_bank_account', country: 'US' }),
      );
    });
  });

  describe('removeByStripeId', () => {
    it('deletes when payment method exists in DB', async () => {
      repo.findByStripeId.mockResolvedValue({ id: 'pm-uuid', stripePaymentMethodId: 'pm_1' });
      await service.removeByStripeId('pm_1');
      expect(repo.deleteById).toHaveBeenCalledWith('pm-uuid');
    });

    it('is a no-op when payment method is not in DB', async () => {
      repo.findByStripeId.mockResolvedValue(null);
      await service.removeByStripeId('pm_unknown');
      expect(repo.deleteById).not.toHaveBeenCalled();
    });
  });
});
