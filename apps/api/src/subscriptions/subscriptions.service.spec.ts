// @ts-nocheck — Stripe SDK overloaded method types prevent TS from recognizing jest.Mock methods at compile time
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SubscriptionsService } from './subscriptions.service';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { RedisService } from '../redis/redis.service';
import { createMockStripe } from '../../test/stripe-mock.factory';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let queryMock: jest.Mock;
  let mockStripe: ReturnType<typeof createMockStripe>;
  let findByIdMock: jest.Mock;

  beforeEach(async () => {
    queryMock = jest.fn();
    mockStripe = createMockStripe();
    findByIdMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        {
          provide: DataSource,
          useValue: {
            query: queryMock,
            createQueryRunner: jest.fn().mockReturnValue({
              connect: jest.fn(),
              startTransaction: jest.fn(),
              commitTransaction: jest.fn(),
              rollbackTransaction: jest.fn(),
              release: jest.fn(),
              query: jest.fn(),
            }),
          },
        },
        { provide: StripeService, useValue: mockStripe },
        { provide: CustomersService, useValue: { findById: findByIdMock } },
        { provide: RedisService, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() } },
      ],
    }).compile();

    service = module.get(SubscriptionsService);
  });

  describe('create', () => {
    const dto = { customerId: 'cust-uuid', priceId: 'price_basic', paymentMethodId: 'pm_card_visa' };
    const idempotencyKey = 'idem-sub-1';

    it('returns existing active subscription for the same customer and price', async () => {
      findByIdMock.mockResolvedValueOnce({ id: 'cust-uuid', stripeCustomerId: 'cus_1' });
      queryMock
        .mockResolvedValueOnce([{ id: 'sub-existing', stripeSubscriptionId: 'sub_stripe_1', status: 'active' }])
        .mockResolvedValueOnce([{ id: 'sub-existing', stripeSubscriptionId: 'sub_stripe_1', status: 'active', customerId: 'cust-uuid' }])
        .mockResolvedValueOnce([{ id: 'cust-uuid', stripeCustomerId: 'cus_1' }]);

      const result = await service.create(dto, idempotencyKey);

      expect(result.id).toBe('sub-existing');
      expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
    });

    it('creates Stripe subscription and stores locally', async () => {
      findByIdMock.mockResolvedValueOnce({ id: 'cust-uuid', stripeCustomerId: 'cus_1' });

      mockStripe.subscriptions.create.mockResolvedValueOnce({
        id: 'sub_new',
        status: 'active',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        cancel_at_period_end: false,
        trial_start: null,
        trial_end: null,
      } as any);

      queryMock
        .mockResolvedValueOnce([]) // No existing active
        .mockResolvedValueOnce([]) // No alreadySaved (INSERT goes via runner.query, not queryMock)
        .mockResolvedValueOnce([{ id: 'sub-new', stripeSubscriptionId: 'sub_new', status: 'active', customerId: 'cust-uuid' }])
        .mockResolvedValueOnce([{ id: 'cust-uuid', stripeCustomerId: 'cus_1' }]);

      const result = await service.create(dto, idempotencyKey);

      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_1', items: [{ price: 'price_basic' }] }),
        { idempotencyKey },
      );
      expect(result.stripeSubscriptionId).toBe('sub_new');
    });
  });

  describe('findById', () => {
    it('returns subscription with customer', async () => {
      queryMock
        .mockResolvedValueOnce([{ id: 'sub-1', stripeSubscriptionId: 'sub_stripe_1', status: 'active', customerId: 'cust-1' }])
        .mockResolvedValueOnce([{ id: 'cust-1', stripeCustomerId: 'cus_1', email: 'a@b.com' }]);

      const result = await service.findById('sub-1');

      expect(result.id).toBe('sub-1');
      expect(result.customer).toBeDefined();
    });

    it('throws NotFoundException for unknown id', async () => {
      queryMock.mockResolvedValueOnce([]);

      await expect(service.findById('nonexistent')).rejects.toThrow('Subscription nonexistent not found');
    });
  });

  describe('cancel', () => {
    it('cancels via Stripe and updates local status', async () => {
      queryMock
        .mockResolvedValueOnce([{ id: 'sub-1', stripeSubscriptionId: 'sub_stripe_1', status: 'active', customerId: 'cust-1' }])
        .mockResolvedValueOnce([{ id: 'cust-1', stripeCustomerId: 'cus_1' }]);
      mockStripe.subscriptions.cancel.mockResolvedValueOnce({ id: 'sub_stripe_1', status: 'canceled', cancel_at_period_end: false } as any);
      queryMock.mockResolvedValueOnce({}); // UPDATE
      queryMock
        .mockResolvedValueOnce([{ id: 'sub-1', stripeSubscriptionId: 'sub_stripe_1', status: 'canceled', customerId: 'cust-1' }])
        .mockResolvedValueOnce([{ id: 'cust-1', stripeCustomerId: 'cus_1' }]);

      const result = await service.cancel('sub-1');

      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_stripe_1');
      expect(result.status).toBe('canceled');
    });
  });

  describe('listByCustomer', () => {
    it('returns paginated subscriptions', async () => {
      queryMock
        .mockResolvedValueOnce([{ cnt: '2' }])
        .mockResolvedValueOnce([
          { id: 'sub-1', stripeSubscriptionId: 's1', status: 'active', customerId: 'cust-1' },
          { id: 'sub-2', stripeSubscriptionId: 's2', status: 'canceled', customerId: 'cust-1' },
        ]);

      const result = await service.listByCustomer('cust-1', 1, 10);

      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
    });
  });
});
