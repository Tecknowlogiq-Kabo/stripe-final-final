import { Test, TestingModule } from '@nestjs/testing';
import { CustomerHandler } from './customer.handler';
import { CustomersService } from '../../customers/customers.service';
import Stripe from 'stripe';

describe('Fix 3: customer.deleted webhook persists IS_DELETED = 1', () => {
  let handler: CustomerHandler;
  let customersService: jest.Mocked<Partial<CustomersService>>;

  const mockCustomer: Stripe.Customer = {
    id: 'cus_deleted_123',
    object: 'customer',
    created: Date.now() / 1000,
    livemode: false,
  } as Stripe.Customer;

  const event: Stripe.Event = {
    id: 'evt_test_deleted',
    object: 'event',
    api_version: '2025-04-30',
    created: Math.floor(Date.now() / 1000),
    data: { object: mockCustomer },
    type: 'customer.deleted',
    livemode: false,
    pending_webhooks: 0,
    request: null,
  };

  beforeEach(async () => {
    customersService = {
      findByStripeId: jest.fn(),
      syncSoftDelete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerHandler,
        { provide: CustomersService, useValue: customersService },
      ],
    }).compile();

    handler = module.get(CustomerHandler);
  });

  it('should call syncSoftDelete (not set isDeleted in memory)', async () => {
    const localCustomer = { id: 'local-123', stripeCustomerId: mockCustomer.id } as any;
    (customersService.findByStripeId as jest.Mock).mockResolvedValue(localCustomer);

    await handler.handle(event);

    expect(customersService.syncSoftDelete).toHaveBeenCalledWith('local-123');
  });

  it('should be idempotent — already-deleted customer skips silently', async () => {
    // First webhook: finds customer
    (customersService.findByStripeId as jest.Mock).mockResolvedValueOnce({
      id: 'local-456',
      stripeCustomerId: mockCustomer.id,
    } as any);

    await handler.handle(event);
    expect(customersService.syncSoftDelete).toHaveBeenCalledTimes(1);

    // Second webhook (retry): customer now IS_DELETED = 1, findByStripeId returns null
    (customersService.findByStripeId as jest.Mock).mockResolvedValueOnce(null);

    await expect(handler.handle(event)).resolves.toBeUndefined();
    // syncSoftDelete should not be called again
    expect(customersService.syncSoftDelete).toHaveBeenCalledTimes(1);
  });
});
