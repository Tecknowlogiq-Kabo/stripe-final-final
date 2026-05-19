// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentIntentsController } from './payment-intents.controller';
import { PaymentIntentsService } from './payment-intents.service';
import { CustomersService } from '../customers/customers.service';

describe('PaymentIntentsController', () => {
  let controller: PaymentIntentsController;
  let paymentIntentsService: {
    create: jest.Mock;
    findById: jest.Mock;
    findByStripeId: jest.Mock;
    findByCustomer: jest.Mock;
    update: jest.Mock;
    cancel: jest.Mock;
  };
  let customersService: {
    findById: jest.Mock;
    findByUserId: jest.Mock;
  };

  beforeEach(async () => {
    paymentIntentsService = {
      create: jest.fn(),
      findById: jest.fn(),
      findByStripeId: jest.fn(),
      findByCustomer: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
    };
    customersService = {
      findById: jest.fn(),
      findByUserId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentIntentsController],
      providers: [
        { provide: PaymentIntentsService, useValue: paymentIntentsService },
        { provide: CustomersService, useValue: customersService },
      ],
    }).compile();

    controller = module.get(PaymentIntentsController);
  });

  describe('create', () => {
    it('creates payment intent with user from auth context', async () => {
      paymentIntentsService.create.mockResolvedValueOnce({
        id: 'pi-local-1',
        clientSecret: 'pi_secret',
        stripePaymentIntentId: 'pi_stripe_1',
        status: 'requires_payment_method',
      });

      const result = await controller.create(
        { amount: 2000, currency: 'usd' },
        'idem-key',
        { id: 'user-1', email: 'owner@example.com' },
      );

      expect(paymentIntentsService.create).toHaveBeenCalledWith(
        { amount: 2000, currency: 'usd' },
        'idem-key',
        'user-1',
        'owner@example.com',
      );
      expect(result.id).toBe('pi-local-1');
    });
  });

  describe('findMine', () => {
    it('returns payment intents for the authenticated user', async () => {
      customersService.findByUserId.mockResolvedValueOnce({ id: 'cust-1', userId: 'user-1' });
      paymentIntentsService.findByCustomer.mockResolvedValueOnce({
        data: [{
          id: 'pi-local-1',
          stripePaymentIntentId: 'pi_1',
          amount: 2000,
          currency: 'usd',
          status: 'succeeded',
          clientSecret: 'pi_secret_should_not_escape',
          customerId: 'cust-1',
          createdAt: new Date('2026-01-01T10:00:00Z'),
          updatedAt: new Date('2026-01-01T10:00:00Z'),
        }],
        total: 1,
        page: 1,
        limit: 10,
      });

      const result = await controller.findMine(
        { page: 1, limit: 10 } as any,
        { id: 'user-1', email: 'owner@example.com' },
      );

      expect(result.data[0]).toEqual(expect.objectContaining({
        id: 'pi-local-1',
        amount: 2000,
        status: 'succeeded',
      }));
      expect((result.data[0] as { clientSecret?: string }).clientSecret).toBeUndefined();
    });

    it('returns empty list when user has no customer', async () => {
      customersService.findByUserId.mockResolvedValueOnce(null);

      const result = await controller.findMine(
        { page: 1, limit: 10 } as any,
        { id: 'user-1', email: 'owner@example.com' },
      );

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('findByStripeId', () => {
    it('returns a sanitized payment intent for the owner', async () => {
      paymentIntentsService.findByStripeId.mockResolvedValueOnce({
        id: 'pi-local-1',
        customerId: 'cust-1',
        status: 'succeeded',
        errorMessage: 'card declined',
        clientSecret: 'pi_secret_should_not_escape',
      });
      customersService.findById.mockResolvedValueOnce({ id: 'cust-1', userId: 'user-1' });

      const result = await controller.findByStripeId('pi_1', { id: 'user-1', email: 'owner@example.com' });

      expect(result).toEqual({
        id: 'pi-local-1',
        status: 'succeeded',
        errorMessage: 'card declined',
      });
      expect((result as { clientSecret?: string }).clientSecret).toBeUndefined();
    });

    it('rejects access to another user payment intent', async () => {
      paymentIntentsService.findByStripeId.mockResolvedValueOnce({
        id: 'pi-local-1',
        customerId: 'cust-2',
        status: 'succeeded',
      });
      customersService.findById.mockResolvedValueOnce({ id: 'cust-2', userId: 'user-2' });

      await expect(
        controller.findByStripeId('pi_1', { id: 'user-1', email: 'owner@example.com' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findOne', () => {
    it('returns a sanitized payment intent for the owner', async () => {
      paymentIntentsService.findById.mockResolvedValueOnce({
        id: 'pi-local-1',
        stripePaymentIntentId: 'pi_1',
        amount: 2000,
        currency: 'usd',
        status: 'succeeded',
        clientSecret: 'pi_secret_should_not_escape',
        customerId: 'cust-1',
        description: 'Test payment',
        createdAt: new Date('2026-01-01T10:00:00Z'),
        updatedAt: new Date('2026-01-01T10:00:00Z'),
      });
      customersService.findById.mockResolvedValueOnce({ id: 'cust-1', userId: 'user-1' });

      const result = await controller.findOne('pi-1', { id: 'user-1', email: 'owner@example.com' });

      expect(result).toEqual(expect.objectContaining({
        id: 'pi-local-1',
        stripePaymentIntentId: 'pi_1',
        amount: 2000,
        currency: 'usd',
        status: 'succeeded',
        description: 'Test payment',
      }));
      expect((result as { clientSecret?: string }).clientSecret).toBeUndefined();
    });
  });

  describe('assertPaymentIntentOwnership', () => {
    it('rejects access when payment intent has no customer', async () => {
      paymentIntentsService.findById.mockResolvedValueOnce({
        id: 'pi-local-1',
        customerId: null,
      });

      await expect(
        controller.findOne('pi-1', { id: 'user-1', email: 'owner@example.com' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});