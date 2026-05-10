// @ts-nocheck — Stripe SDK overloaded method types prevent TS from recognizing jest.Mock methods at compile time
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CustomersService } from './customers.service';
import { StripeService } from '../stripe/stripe.service';
import { RedisService } from '../redis/redis.service';
import { createMockStripe } from '../../test/stripe-mock.factory';

describe('CustomersService', () => {
  let service: CustomersService;
  let queryMock: jest.Mock;
  let mockStripe: ReturnType<typeof createMockStripe>;
  let redisGetMock: jest.Mock;
  let redisSetMock: jest.Mock;
  let redisDelMock: jest.Mock;

  beforeEach(async () => {
    queryMock = jest.fn();
    mockStripe = createMockStripe();
    redisGetMock = jest.fn().mockResolvedValue(null);
    redisSetMock = jest.fn();
    redisDelMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: DataSource, useValue: { query: queryMock, createQueryRunner: jest.fn() } },
        { provide: StripeService, useValue: mockStripe },
        { provide: RedisService, useValue: { get: redisGetMock, set: redisSetMock, del: redisDelMock } },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  describe('create', () => {
    const dto = { email: 'test@example.com', name: 'Test User' };
    const idempotencyKey = 'idem-1';
    const userId = 'user-1';

    it('returns cached customer on idempotency match', async () => {
      queryMock.mockResolvedValueOnce([{ id: 'cust-1', email: 'test@example.com', stripeCustomerId: 'cus_1' }]);

      const result = await service.create(dto, idempotencyKey, userId);

      expect(result.id).toBe('cust-1');
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when email already exists', async () => {
      queryMock
        .mockResolvedValueOnce([]) // No idempotency
        .mockResolvedValueOnce([{ id: 'existing', email: 'test@example.com' }]); // Email exists

      await expect(service.create(dto, idempotencyKey, userId)).rejects.toThrow(
        'A customer with this email already exists',
      );
    });
  });

  describe('findById', () => {
    it('returns from cache when available', async () => {
      redisGetMock.mockResolvedValueOnce({ id: 'cust-1', email: 'cached@test.com' });

      const result = await service.findById('cust-1');

      expect(result.email).toBe('cached@test.com');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('fetches from DB and caches when not cached', async () => {
      queryMock
        .mockResolvedValueOnce([{ id: 'cust-1', email: 'db@test.com', stripeCustomerId: 'cus_1' }])
        .mockResolvedValueOnce([]) // payment methods
        .mockResolvedValueOnce([]); // subscriptions

      const result = await service.findById('cust-1');

      expect(result.email).toBe('db@test.com');
      expect(redisSetMock).toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown id', async () => {
      queryMock.mockResolvedValueOnce([]);

      await expect(service.findById('nonexistent')).rejects.toThrow('Customer nonexistent not found');
    });
  });

  describe('softDelete', () => {
    it('deletes from Stripe, marks deleted locally, clears cache', async () => {
      redisGetMock.mockResolvedValueOnce({ id: 'cust-1', stripeCustomerId: 'cus_1' });
      mockStripe.customers.del.mockResolvedValueOnce({ id: 'cus_1', deleted: true } as any);
      queryMock.mockResolvedValueOnce({});

      await service.softDelete('cust-1');

      expect(mockStripe.customers.del).toHaveBeenCalledWith('cus_1');
      expect(redisDelMock).toHaveBeenCalled();
    });
  });

  describe('createCustomerSession', () => {
    it('creates a customer session and returns client secret', async () => {
      redisGetMock.mockResolvedValueOnce({ id: 'cust-1', stripeCustomerId: 'cus_1' });
      mockStripe.customerSessions.create.mockResolvedValueOnce({ client_secret: 'cs_secret' } as any);

      const result = await service.createCustomerSession('cust-1');

      expect(result.clientSecret).toBe('cs_secret');
      expect(mockStripe.customerSessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_1' }),
      );
    });
  });
});
