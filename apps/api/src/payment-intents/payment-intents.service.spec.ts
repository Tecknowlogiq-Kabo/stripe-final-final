// @ts-nocheck — Stripe SDK overloaded method types prevent TS from recognizing jest.Mock methods at compile time, but runtime values ARE jest.Mocks
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PaymentIntentsService } from './payment-intents.service';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { createMockStripe } from '../../test/stripe-mock.factory';
import { TEST_PAYMENT_METHODS } from '../../test/stripe-test-cards';

describe('PaymentIntentsService', () => {
  let service: PaymentIntentsService;
  let queryMock: jest.Mock;
  let mockStripe: ReturnType<typeof createMockStripe>;
  let findByIdMock: jest.Mock;

  beforeEach(async () => {
    queryMock = jest.fn();
    mockStripe = createMockStripe();
    findByIdMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentIntentsService,
        { provide: DataSource, useValue: { query: queryMock } },
        { provide: StripeService, useValue: mockStripe },
        { provide: CustomersService, useValue: { findById: findByIdMock } },
      ],
    }).compile();

    service = module.get(PaymentIntentsService);
  });

  describe('create', () => {
    const dto = {
      amount: 2000,
      currency: 'usd',
      customerId: 'cust-uuid',
      paymentMethodId: TEST_PAYMENT_METHODS.visa,
      description: 'Test payment',
    };
    const idempotencyKey = 'idem-key-1';

    it('returns cached payment intent when idempotency key matches', async () => {
      queryMock.mockResolvedValueOnce([{
        id: 'pi-local-1',
        clientSecret: 'pi_secret_cached',
        stripePaymentIntentId: 'pi_stripe_cached',
        status: 'succeeded',
      }]);

      const result = await service.create(dto, idempotencyKey);

      expect(result.id).toBe('pi-local-1');
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('creates Stripe payment intent and stores locally', async () => {
      findByIdMock.mockResolvedValueOnce({ id: 'cust-uuid', stripeCustomerId: 'cus_stripe1' });

      mockStripe.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_stripe_new',
        client_secret: 'pi_secret_new',
        status: 'requires_payment_method',
        amount: 2000,
        currency: 'usd',
        payment_method_types: ['card'],
        amount_received: null,
        amount_capturable: null,
        next_action: null,
        livemode: false,
      } as any);

      queryMock
        .mockResolvedValueOnce([]) // No cached
        .mockResolvedValueOnce({}) // INSERT
        .mockResolvedValueOnce([{ // Saved record
          id: 'pi-local-new',
          clientSecret: 'pi_secret_new',
          stripePaymentIntentId: 'pi_stripe_new',
          status: 'requires_payment_method',
        }]);

      const result = await service.create(dto, idempotencyKey);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 2000, currency: 'usd', customer: 'cus_stripe1' }),
        { idempotencyKey },
      );
      expect(result.stripePaymentIntentId).toBe('pi_stripe_new');
    });

    it('throws when Stripe PaymentIntent is missing client_secret', async () => {
      findByIdMock.mockResolvedValueOnce({ id: 'cust-uuid', stripeCustomerId: 'cus_stripe1' });
      queryMock.mockResolvedValueOnce([]);
      mockStripe.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_no_secret',
        client_secret: null,
      } as any);

      await expect(service.create(dto, idempotencyKey)).rejects.toThrow('missing client_secret');
    });
  });

  describe('findById', () => {
    it('returns payment intent with customer', async () => {
      queryMock
        .mockResolvedValueOnce([{
          id: 'pi-1', stripePaymentIntentId: 'pi_stripe_1', amount: 2000,
          currency: 'usd', status: 'succeeded', customerId: 'cust-1',
        }])
        .mockResolvedValueOnce([{ id: 'cust-1', stripeCustomerId: 'cus_stripe', email: 'a@b.com' }]);

      const result = await service.findById('pi-1');

      expect(result.id).toBe('pi-1');
      expect(result.customer).toBeDefined();
    });

    it('throws NotFoundException for unknown id', async () => {
      queryMock.mockResolvedValueOnce([]);

      await expect(service.findById('nonexistent')).rejects.toThrow('PaymentIntent nonexistent not found');
    });
  });

  describe('cancel', () => {
    it('cancels via Stripe and updates local status', async () => {
      queryMock
        .mockResolvedValueOnce([{
          id: 'pi-1', stripePaymentIntentId: 'pi_stripe_1', status: 'requires_payment_method', customerId: 'cust-1',
        }])
        .mockResolvedValueOnce([{ id: 'cust-1', stripeCustomerId: 'cus_stripe' }]);
      mockStripe.paymentIntents.cancel.mockResolvedValueOnce({ id: 'pi_stripe_1', status: 'canceled' } as any);
      queryMock.mockResolvedValueOnce({}); // UPDATE
      queryMock
        .mockResolvedValueOnce([{ id: 'pi-1', stripePaymentIntentId: 'pi_stripe_1', status: 'canceled', customerId: 'cust-1' }])
        .mockResolvedValueOnce([{ id: 'cust-1', stripeCustomerId: 'cus_stripe' }]);

      const result = await service.cancel('pi-1');

      expect(mockStripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_stripe_1');
      expect(result.status).toBe('canceled');
    });
  });
});
