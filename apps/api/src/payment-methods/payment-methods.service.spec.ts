import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsRepository } from './payment-methods.repository';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';

describe('PaymentMethodsService', () => {
  let service: PaymentMethodsService;
  let repo: {
    findById: jest.Mock;
    findByIdAndCustomer: jest.Mock;
    findByStripeId: jest.Mock;
    listByCustomer: jest.Mock;
    deleteById: jest.Mock;
    clearDefaultByCustomer: jest.Mock;
    setDefault: jest.Mock;
    updateFields: jest.Mock;
    insertNew: jest.Mock;
    upsertFromStripeEvent: jest.Mock;
  };
  let stripeService: {
    paymentMethods: { detach: jest.Mock; retrieve: jest.Mock };
    customers: { update: jest.Mock };
  };
  let customersService: { findById: jest.Mock; findByStripeId: jest.Mock };

  beforeEach(async () => {
    repo = {
      findById: jest.fn(),
      findByIdAndCustomer: jest.fn(),
      findByStripeId: jest.fn(),
      listByCustomer: jest.fn(),
      deleteById: jest.fn(),
      clearDefaultByCustomer: jest.fn(),
      setDefault: jest.fn(),
      updateFields: jest.fn(),
      insertNew: jest.fn(),
      upsertFromStripeEvent: jest.fn(),
    };
    stripeService = {
      paymentMethods: { detach: jest.fn(), retrieve: jest.fn() },
      customers: { update: jest.fn() },
    };
    customersService = { findById: jest.fn(), findByStripeId: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodsService,
        { provide: PaymentMethodsRepository, useValue: repo },
        { provide: StripeService, useValue: stripeService },
        { provide: CustomersService, useValue: customersService },
      ],
    }).compile();

    service = module.get<PaymentMethodsService>(PaymentMethodsService);
  });

  describe('listByCustomer', () => {
    it('returns paginated payment methods for an existing customer', async () => {
      customersService.findById.mockResolvedValueOnce({ id: 'cust-1' });
      repo.listByCustomer.mockResolvedValueOnce({
        data: [{ id: 'pm-1' }, { id: 'pm-2' }],
        total: 2,
      });

      const result = await service.listByCustomer('cust-1', 1, 20);

      expect(result).toEqual({
        data: [{ id: 'pm-1' }, { id: 'pm-2' }],
        total: 2,
        page: 1,
        limit: 20,
      });
      // Ownership check happens via customersService.findById
      expect(customersService.findById).toHaveBeenCalledWith('cust-1');
      // Pagination: page 1 → offset 0
      expect(repo.listByCustomer).toHaveBeenCalledWith('cust-1', 0, 20);
    });

    it('computes correct offset for page > 1', async () => {
      customersService.findById.mockResolvedValueOnce({ id: 'cust-1' });
      repo.listByCustomer.mockResolvedValueOnce({ data: [], total: 0 });

      await service.listByCustomer('cust-1', 3, 10);

      expect(repo.listByCustomer).toHaveBeenCalledWith('cust-1', 20, 10);
    });
  });

  describe('findById', () => {
    it('returns the payment method when found', async () => {
      repo.findById.mockResolvedValueOnce({ id: 'pm-1' });
      await expect(service.findById('pm-1')).resolves.toEqual({ id: 'pm-1' });
    });

    it('throws NotFoundException when missing — protects against silent miss', async () => {
      repo.findById.mockResolvedValueOnce(null);
      await expect(service.findById('pm-x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('detach', () => {
    it('detaches in Stripe then removes from DB (order matters: Stripe is source of truth)', async () => {
      repo.findById.mockResolvedValueOnce({
        id: 'pm-1',
        stripePaymentMethodId: 'pm_stripe_1',
      });

      await service.detach('pm-1');

      expect(stripeService.paymentMethods.detach).toHaveBeenCalledWith('pm_stripe_1');
      expect(repo.deleteById).toHaveBeenCalledWith('pm-1');
    });

    it('throws NotFoundException for unknown id and never calls Stripe', async () => {
      repo.findById.mockResolvedValueOnce(null);

      await expect(service.detach('pm-missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(stripeService.paymentMethods.detach).not.toHaveBeenCalled();
      expect(repo.deleteById).not.toHaveBeenCalled();
    });
  });
});
