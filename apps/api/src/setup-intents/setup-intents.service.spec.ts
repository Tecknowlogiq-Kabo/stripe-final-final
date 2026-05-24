import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { SetupIntentsService } from './setup-intents.service';
import { SetupIntentsRepository } from './setup-intents.repository';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';

describe('SetupIntentsService', () => {
  let service: SetupIntentsService;
  let repo: {
    findByIdempotencyKey: jest.Mock;
    findById: jest.Mock;
    findByStripeId: jest.Mock;
    findCustomerById: jest.Mock;
    insert: jest.Mock;
    updateStatus: jest.Mock;
    updateStatusById: jest.Mock;
  };
  let stripeService: {
    setupIntents: { create: jest.Mock; cancel: jest.Mock };
  };
  let customersService: { findById: jest.Mock };

  beforeEach(async () => {
    repo = {
      findByIdempotencyKey: jest.fn(),
      findById: jest.fn(),
      findByStripeId: jest.fn(),
      findCustomerById: jest.fn(),
      insert: jest.fn(),
      updateStatus: jest.fn(),
      updateStatusById: jest.fn(),
    };
    stripeService = {
      setupIntents: { create: jest.fn(), cancel: jest.fn() },
    };
    customersService = { findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupIntentsService,
        { provide: SetupIntentsRepository, useValue: repo },
        { provide: StripeService, useValue: stripeService },
        { provide: CustomersService, useValue: customersService },
      ],
    }).compile();

    service = module.get<SetupIntentsService>(SetupIntentsService);
  });

  describe('create', () => {
    it('creates a Stripe SetupIntent and persists it locally', async () => {
      repo.findByIdempotencyKey.mockResolvedValueOnce(null);
      customersService.findById.mockResolvedValueOnce({
        id: 'cust-1',
        stripeCustomerId: 'cus_stripe_1',
      });
      stripeService.setupIntents.create.mockResolvedValueOnce({
        id: 'seti_test_1',
        client_secret: 'seti_secret_xyz',
        status: 'requires_payment_method',
        livemode: false,
        payment_method_types: ['card'],
        next_action: null,
      });
      repo.insert.mockResolvedValueOnce(undefined);

      const result = await service.create(
        { customerId: 'cust-1' },
        'idem-key-1',
      );

      expect(result).toEqual(
        expect.objectContaining({
          clientSecret: 'seti_secret_xyz',
          stripeSetupIntentId: 'seti_test_1',
          status: 'requires_payment_method',
        }),
      );
      // Idempotency key must reach Stripe — protects against duplicates
      expect(stripeService.setupIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_stripe_1' }),
        { idempotencyKey: 'idem-key-1' },
      );
      expect(repo.insert).toHaveBeenCalled();
    });

    it('returns the existing record when idempotency key already used (no Stripe call)', async () => {
      repo.findByIdempotencyKey.mockResolvedValueOnce({
        id: 'si-existing',
        clientSecret: 'cached_secret',
        stripeSetupIntentId: 'seti_existing',
        status: 'succeeded',
      });

      const result = await service.create(
        { customerId: 'cust-1' },
        'idem-replay',
      );

      expect(result).toEqual({
        id: 'si-existing',
        clientSecret: 'cached_secret',
        stripeSetupIntentId: 'seti_existing',
        status: 'succeeded',
      });
      // Critical: NO Stripe call on replay — otherwise we'd create duplicate intents
      expect(stripeService.setupIntents.create).not.toHaveBeenCalled();
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('cancels the Stripe SI if DB insert fails (avoids orphans)', async () => {
      repo.findByIdempotencyKey.mockResolvedValueOnce(null);
      customersService.findById.mockResolvedValueOnce({
        id: 'cust-1',
        stripeCustomerId: 'cus_stripe_1',
      });
      stripeService.setupIntents.create.mockResolvedValueOnce({
        id: 'seti_orphan',
        client_secret: 'orphan_secret',
        status: 'requires_payment_method',
        livemode: false,
        payment_method_types: ['card'],
        next_action: null,
      });
      repo.insert.mockRejectedValueOnce(new Error('DB down'));
      stripeService.setupIntents.cancel.mockResolvedValueOnce(undefined);

      await expect(
        service.create({ customerId: 'cust-1' }, 'idem-orphan'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      // Verify orphan cleanup happened
      expect(stripeService.setupIntents.cancel).toHaveBeenCalledWith('seti_orphan');
    });
  });

  describe('findById', () => {
    it('returns the setup intent enriched with customer when found', async () => {
      repo.findById.mockResolvedValueOnce({
        id: 'si-1',
        customerId: 'cust-1',
        status: 'succeeded',
      });
      repo.findCustomerById.mockResolvedValueOnce({ id: 'cust-1', name: 'Alice' });

      const result = await service.findById('si-1');

      expect(result.id).toBe('si-1');
      expect((result as { customer?: unknown }).customer).toEqual({
        id: 'cust-1',
        name: 'Alice',
      });
    });

    it('throws NotFoundException when missing', async () => {
      repo.findById.mockResolvedValueOnce(null);
      await expect(service.findById('si-missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findByStripeId', () => {
    it('delegates to the repository', async () => {
      repo.findByStripeId.mockResolvedValueOnce({ id: 'si-1' });
      const result = await service.findByStripeId('seti_1');
      expect(result).toEqual({ id: 'si-1' });
      expect(repo.findByStripeId).toHaveBeenCalledWith('seti_1');
    });

    it('returns null when not found (no exception — caller decides)', async () => {
      repo.findByStripeId.mockResolvedValueOnce(null);
      await expect(service.findByStripeId('seti_unknown')).resolves.toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('updates status when setup intent is known', async () => {
      repo.findByStripeId.mockResolvedValueOnce({
        id: 'si-1',
        stripePaymentMethodId: null,
        lastSetupError: null,
      });

      await service.updateStatus('seti_1', 'succeeded', 'pm_attached');

      expect(repo.updateStatus).toHaveBeenCalledWith(
        'si-1',
        'succeeded',
        'pm_attached',
        null,
      );
    });

    it('is a silent no-op when the setup intent is unknown (webhook race)', async () => {
      repo.findByStripeId.mockResolvedValueOnce(null);
      await expect(
        service.updateStatus('seti_unknown', 'succeeded'),
      ).resolves.toBeUndefined();
      expect(repo.updateStatus).not.toHaveBeenCalled();
    });
  });
});
