// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SetupIntentsController } from './setup-intents.controller';
import { SetupIntentsService } from './setup-intents.service';
import { CustomersService } from '../customers/customers.service';

describe('SetupIntentsController', () => {
  let controller: SetupIntentsController;
  let setupIntentsService: {
    create: jest.Mock;
    findById: jest.Mock;
    cancel: jest.Mock;
  };
  let customersService: {
    findById: jest.Mock;
  };

  beforeEach(async () => {
    setupIntentsService = {
      create: jest.fn(),
      findById: jest.fn(),
      cancel: jest.fn(),
    };
    customersService = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SetupIntentsController],
      providers: [
        { provide: SetupIntentsService, useValue: setupIntentsService },
        { provide: CustomersService, useValue: customersService },
      ],
    }).compile();

    controller = module.get(SetupIntentsController);
  });

  it('allows the owner to create a setup intent', async () => {
    customersService.findById.mockResolvedValueOnce({ id: 'cust-1', userId: 'user-1' });
    setupIntentsService.create.mockResolvedValueOnce({ id: 'si-1', clientSecret: 'seti_secret', stripeSetupIntentId: 'seti_1', status: 'requires_payment_method' });

    const result = await controller.create(
      { customerId: 'cust-1' } as any,
      'idem-1',
      { id: 'user-1', email: 'owner@example.com' },
    );

    expect(result.stripeSetupIntentId).toBe('seti_1');
    expect(setupIntentsService.create).toHaveBeenCalledWith({ customerId: 'cust-1' }, 'idem-1');
  });

  it('rejects creating a setup intent for another user', async () => {
    customersService.findById.mockResolvedValueOnce({ id: 'cust-1', userId: 'user-2' });

    await expect(
      controller.create(
        { customerId: 'cust-1' } as any,
        'idem-1',
        { id: 'user-1', email: 'owner@example.com' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(setupIntentsService.create).not.toHaveBeenCalled();
  });

  it('allows the owner to fetch a setup intent', async () => {
    setupIntentsService.findById.mockResolvedValueOnce({
      id: 'si-1',
      customerId: 'cust-1',
      status: 'requires_payment_method',
      clientSecret: 'seti_secret_should_not_escape',
    });
    customersService.findById.mockResolvedValueOnce({ id: 'cust-1', userId: 'user-1' });

    const result = await controller.findOne('si-1', { id: 'user-1', email: 'owner@example.com' });

    expect(result.id).toBe('si-1');
    expect((result as { clientSecret?: string }).clientSecret).toBeUndefined();
  });

  it('rejects fetching another user setup intent', async () => {
    setupIntentsService.findById.mockResolvedValueOnce({ id: 'si-1', customerId: 'cust-2', status: 'requires_payment_method' });
    customersService.findById.mockResolvedValueOnce({ id: 'cust-2', userId: 'user-2' });

    await expect(
      controller.findOne('si-1', { id: 'user-1', email: 'owner@example.com' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the owner to cancel a setup intent', async () => {
    setupIntentsService.findById.mockResolvedValueOnce({
      id: 'si-1',
      customerId: 'cust-1',
      status: 'requires_payment_method',
      clientSecret: 'seti_secret_should_not_escape',
    });
    customersService.findById.mockResolvedValueOnce({ id: 'cust-1', userId: 'user-1' });
    setupIntentsService.cancel.mockResolvedValueOnce({
      id: 'si-1',
      customerId: 'cust-1',
      status: 'canceled',
      clientSecret: 'seti_secret_should_not_escape',
    });

    const result = await controller.cancel('si-1', { id: 'user-1', email: 'owner@example.com' });

    expect(result.status).toBe('canceled');
    expect(setupIntentsService.cancel).toHaveBeenCalledWith('si-1');
    expect((result as { clientSecret?: string }).clientSecret).toBeUndefined();
  });
});
