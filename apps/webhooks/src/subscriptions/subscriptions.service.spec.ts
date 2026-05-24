import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { RedisService } from '../redis/redis.service';

interface MockRepo {
  findByStripeId: jest.Mock;
  syncUpdate: jest.Mock;
  insertFromStripeEvent: jest.Mock;
  syncUpdateStatus: jest.Mock;
}
interface MockCustomersService {
  findByStripeId: jest.Mock;
}

const makeStripeSub = (overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription =>
  ({
    id: 'sub_stripe_1',
    status: 'active',
    customer: 'cus_stripe_1',
    current_period_start: 1_700_000_000,
    current_period_end: 1_700_100_000,
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    default_payment_method: null,
    items: { data: [{ price: { id: 'price_1' } }] },
    ...overrides,
  } as unknown as Stripe.Subscription);

describe('SubscriptionsService (webhook paths)', () => {
  let service: SubscriptionsService;
  let repo: MockRepo;
  let customers: MockCustomersService;

  beforeEach(async () => {
    repo = {
      findByStripeId: jest.fn(),
      syncUpdate: jest.fn().mockResolvedValue(undefined),
      insertFromStripeEvent: jest.fn().mockResolvedValue(undefined),
      syncUpdateStatus: jest.fn().mockResolvedValue(undefined),
    };
    customers = { findByStripeId: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: SubscriptionsRepository, useValue: repo },
        { provide: StripeService, useValue: {} },
        { provide: CustomersService, useValue: customers },
        { provide: RedisService, useValue: { get: jest.fn(), set: jest.fn() } },
      ],
    }).compile();

    service = module.get(SubscriptionsService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('syncFromStripeEvent', () => {
    it('updates existing subscription found by stripe id', async () => {
      repo.findByStripeId.mockResolvedValue({
        id: 'sub-uuid',
        trialStart: null,
        trialEnd: null,
        defaultPaymentMethodId: null,
      });
      await service.syncFromStripeEvent(makeStripeSub({ status: 'past_due' }));
      expect(repo.syncUpdate).toHaveBeenCalledWith(
        'sub-uuid',
        'past_due',
        new Date(1_700_000_000 * 1000),
        new Date(1_700_100_000 * 1000),
        0,
        null,
        null,
        null,
      );
      expect(repo.insertFromStripeEvent).not.toHaveBeenCalled();
      expect(customers.findByStripeId).not.toHaveBeenCalled();
    });

    it('inserts new subscription when not found locally and customer exists', async () => {
      repo.findByStripeId.mockResolvedValue(null);
      customers.findByStripeId.mockResolvedValue({ id: 'cust-uuid' });

      await service.syncFromStripeEvent(makeStripeSub());

      expect(customers.findByStripeId).toHaveBeenCalledWith('cus_stripe_1');
      expect(repo.insertFromStripeEvent).toHaveBeenCalledWith(
        expect.any(String),
        'sub_stripe_1',
        'active',
        new Date(1_700_000_000 * 1000),
        new Date(1_700_100_000 * 1000),
        0,
        null,
        null,
        'price_1',
        null,
        'cust-uuid',
      );
    });

    it('throws when customer not found (so BullMQ retries the job)', async () => {
      repo.findByStripeId.mockResolvedValue(null);
      customers.findByStripeId.mockRejectedValue(new NotFoundException('not found'));

      await expect(service.syncFromStripeEvent(makeStripeSub())).rejects.toThrow(NotFoundException);
      expect(repo.insertFromStripeEvent).not.toHaveBeenCalled();
    });

    it('passes trial dates and default_payment_method when present', async () => {
      repo.findByStripeId.mockResolvedValue(null);
      customers.findByStripeId.mockResolvedValue({ id: 'cust-uuid' });

      await service.syncFromStripeEvent(
        makeStripeSub({
          trial_start: 1_700_000_001,
          trial_end: 1_700_000_002,
          cancel_at_period_end: true,
          default_payment_method: 'pm_1' as unknown as string,
        }),
      );

      expect(repo.insertFromStripeEvent).toHaveBeenCalledWith(
        expect.any(String),
        'sub_stripe_1',
        'active',
        expect.any(Date),
        expect.any(Date),
        1,
        new Date(1_700_000_001 * 1000),
        new Date(1_700_000_002 * 1000),
        'price_1',
        'pm_1',
        'cust-uuid',
      );
    });
  });

  describe('setStatus', () => {
    it('delegates to repo.syncUpdateStatus', async () => {
      await service.setStatus('sub-uuid', 'past_due');
      expect(repo.syncUpdateStatus).toHaveBeenCalledWith('sub-uuid', 'past_due');
    });
  });
});
