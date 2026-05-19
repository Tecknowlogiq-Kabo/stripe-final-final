// @ts-nocheck — Stripe SDK overloaded method types prevent TS from recognizing jest.Mock methods at compile time, but runtime values ARE jest.Mocks
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentIntentsService } from './payment-intents.service';
import { PaymentIntentsRepository } from './payment-intents.repository';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { createMockStripe } from '../../test/stripe-mock.factory';
import { TEST_PAYMENT_METHODS } from '../../test/stripe-test-cards';

describe('PaymentIntentsService', () => {
  let service: PaymentIntentsService;
  let repoMock: Record<string, jest.Mock>;
  let mockStripe: ReturnType<typeof createMockStripe>;
  let findByUserIdMock: jest.Mock;
  let createCustomerMock: jest.Mock;

  beforeEach(async () => {
    repoMock = {
      findByIdempotencyKey: jest.fn(),
      findById: jest.fn(),
      findCustomerById: jest.fn(),
      findByStripeId: jest.fn(),
      findByCustomer: jest.fn(),
      insert: jest.fn(),
      updateMetadata: jest.fn(),
      updateStatus: jest.fn(),
    };
    mockStripe = createMockStripe();
    findByUserIdMock = jest.fn();
    createCustomerMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentIntentsService,
        { provide: PaymentIntentsRepository, useValue: repoMock },
        { provide: StripeService, useValue: mockStripe },
        { provide: CustomersService, useValue: {
          findByUserId: findByUserIdMock,
          create: createCustomerMock,
        } },
      ],
    }).compile();

    service = module.get(PaymentIntentsService);
  });

  describe('create', () => {
    const dto = {
      amount: 2000,
      currency: 'usd',
      paymentMethodId: TEST_PAYMENT_METHODS.visa,
      description: 'Test payment',
    };
    const idempotencyKey = 'idem-key-1';
    const userId = 'user-1';
    const userEmail = 'owner@example.com';

    it('returns cached payment intent when idempotency key matches', async () => {
      repoMock.findByIdempotencyKey.mockResolvedValueOnce({
        id: 'pi-local-1',
        clientSecret: 'pi_secret_cached',
        stripePaymentIntentId: 'pi_stripe_cached',
        status: 'succeeded',
      });

      const result = await service.create(dto, idempotencyKey, userId, userEmail);

      expect(result.id).toBe('pi-local-1');
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('auto-resolves existing customer and creates payment intent', async () => {
      findByUserIdMock.mockResolvedValueOnce({ id: 'cust-uuid', stripeCustomerId: 'cus_stripe1' });
      repoMock.findByIdempotencyKey.mockResolvedValueOnce(null);

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

      repoMock.insert.mockResolvedValueOnce({
        id: 'pi-local-new',
        clientSecret: 'pi_secret_new',
        stripePaymentIntentId: 'pi_stripe_new',
        status: 'requires_payment_method',
      });

      const result = await service.create(dto, idempotencyKey, userId, userEmail);

      expect(findByUserIdMock).toHaveBeenCalledWith(userId);
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 2000, currency: 'usd', customer: 'cus_stripe1' }),
        { idempotencyKey },
      );
      expect(result.stripePaymentIntentId).toBe('pi_stripe_new');
    });

    it('auto-creates customer when user has none and creates payment intent', async () => {
      findByUserIdMock.mockResolvedValueOnce(null);
      createCustomerMock.mockResolvedValueOnce({ id: 'cust-new', stripeCustomerId: 'cus_stripe_new' });
      repoMock.findByIdempotencyKey.mockResolvedValueOnce(null);

      mockStripe.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_stripe_auto',
        client_secret: 'pi_secret_auto',
        status: 'requires_payment_method',
        amount: 2000,
        currency: 'usd',
        payment_method_types: ['card'],
        amount_received: null,
        amount_capturable: null,
        next_action: null,
        livemode: false,
      } as any);

      repoMock.insert.mockResolvedValueOnce({
        id: 'pi-local-auto',
        clientSecret: 'pi_secret_auto',
        stripePaymentIntentId: 'pi_stripe_auto',
        status: 'requires_payment_method',
      });

      const result = await service.create(dto, idempotencyKey, userId, userEmail);

      expect(createCustomerMock).toHaveBeenCalledWith(
        { email: userEmail },
        idempotencyKey,
        userId,
      );
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_stripe_new' }),
        { idempotencyKey },
      );
      expect(result.stripePaymentIntentId).toBe('pi_stripe_auto');
    });

    it('throws when Stripe PaymentIntent is missing client_secret', async () => {
      findByUserIdMock.mockResolvedValueOnce({ id: 'cust-uuid', stripeCustomerId: 'cus_stripe1' });
      repoMock.findByIdempotencyKey.mockResolvedValueOnce(null);
      mockStripe.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_no_secret',
        client_secret: null,
      } as any);

      await expect(service.create(dto, idempotencyKey, userId, userEmail)).rejects.toThrow('missing client_secret');
    });
  });

  describe('findById', () => {
    it('returns payment intent with customer', async () => {
      repoMock.findById.mockResolvedValueOnce({
        id: 'pi-1', stripePaymentIntentId: 'pi_stripe_1', amount: 2000,
        currency: 'usd', status: 'succeeded', customerId: 'cust-1',
      });
      repoMock.findCustomerById.mockResolvedValueOnce({ id: 'cust-1', stripeCustomerId: 'cus_stripe', email: 'a@b.com' });

      const result = await service.findById('pi-1');

      expect(result.id).toBe('pi-1');
      expect(result.customer).toBeDefined();
    });

    it('throws NotFoundException for unknown id', async () => {
      repoMock.findById.mockResolvedValueOnce(null);

      await expect(service.findById('nonexistent')).rejects.toThrow('PaymentIntent nonexistent not found');
    });
  });

  describe('cancel', () => {
    it('cancels via Stripe and updates local status', async () => {
      repoMock.findById
        .mockResolvedValueOnce({
          id: 'pi-1', stripePaymentIntentId: 'pi_stripe_1', status: 'requires_payment_method', customerId: 'cust-1',
        })
        .mockResolvedValueOnce({
          id: 'pi-1', stripePaymentIntentId: 'pi_stripe_1', status: 'canceled', customerId: 'cust-1',
        });
      repoMock.findCustomerById
        .mockResolvedValueOnce({ id: 'cust-1', stripeCustomerId: 'cus_stripe' })
        .mockResolvedValueOnce({ id: 'cust-1', stripeCustomerId: 'cus_stripe' });
      mockStripe.paymentIntents.cancel.mockResolvedValueOnce({ id: 'pi_stripe_1', status: 'canceled' } as any);

      const result = await service.cancel('pi-1');

      expect(mockStripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_stripe_1');
      expect(result.status).toBe('canceled');
    });
  });
});