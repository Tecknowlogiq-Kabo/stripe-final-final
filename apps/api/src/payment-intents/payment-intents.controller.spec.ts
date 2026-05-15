// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PaymentIntentsController } from './payment-intents.controller';
import { PaymentIntentsService } from './payment-intents.service';
import { CustomersService } from '../customers/customers.service';

describe('PaymentIntentsController', () => {
  let controller: PaymentIntentsController;
  let paymentIntentsService: {
    findById: jest.Mock;
    findByStripeId: jest.Mock;
    findByCustomer: jest.Mock;
    update: jest.Mock;
    cancel: jest.Mock;
  };
  let customersService: {
    findById: jest.Mock;
  };

  beforeEach(async () => {
    paymentIntentsService = {
      findById: jest.fn(),
      findByStripeId: jest.fn(),
      findByCustomer: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
    };
    customersService = {
      findById: jest.fn(),
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

  it('sanitizes payment history rows for the owner', async () => {
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
    customersService.findById.mockResolvedValueOnce({ id: 'cust-1', userId: 'user-1' });

    const result = await controller.findByCustomer(
      'cust-1',
      { page: 1, limit: 10 } as any,
      { id: 'user-1', email: 'owner@example.com' },
    );

    expect(result.data[0]).toEqual(expect.objectContaining({
      id: 'pi-local-1',
      stripePaymentIntentId: 'pi_1',
      amount: 2000,
      currency: 'usd',
      status: 'succeeded',
    }));
    expect((result.data[0] as { clientSecret?: string }).clientSecret).toBeUndefined();
  });
});
