import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { SubscriptionHandler } from './subscription.handler';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { AuditService } from '../../audit/audit.service';

interface MockSubscriptionsService {
  syncFromStripeEvent: jest.Mock;
}
interface MockAuditService {
  log: jest.Mock;
}

const makeSub = (overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription =>
  ({
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    current_period_start: 0,
    current_period_end: 0,
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    canceled_at: null,
    pending_update: null,
    items: { data: [{ price: { id: 'price_1' } }] },
    ...overrides,
  } as unknown as Stripe.Subscription);

const makeEvent = (type: string, object: Stripe.Subscription): Stripe.Event =>
  ({ id: 'evt_1', type, data: { object } } as unknown as Stripe.Event);

describe('SubscriptionHandler', () => {
  let handler: SubscriptionHandler;
  let subs: MockSubscriptionsService;
  let audit: MockAuditService;

  beforeEach(async () => {
    subs = { syncFromStripeEvent: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionHandler,
        { provide: SubscriptionsService, useValue: subs },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    handler = module.get<SubscriptionHandler>(SubscriptionHandler);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('customer.subscription.created: syncs and audits', async () => {
    await handler.handle(makeEvent('customer.subscription.created', makeSub()));
    expect(subs.syncFromStripeEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub_1' }));
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subscription.created', status: 'success' }),
    );
  });

  it.each([
    'customer.subscription.updated',
    'customer.subscription.paused',
    'customer.subscription.resumed',
  ])('%s: syncs without audit', async (type) => {
    await handler.handle(makeEvent(type, makeSub()));
    expect(subs.syncFromStripeEvent).toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('customer.subscription.deleted: syncs and audits', async () => {
    await handler.handle(
      makeEvent('customer.subscription.deleted', makeSub({ status: 'canceled', canceled_at: 1234 })),
    );
    expect(subs.syncFromStripeEvent).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subscription.deleted', status: 'success' }),
    );
  });

  it('customer.subscription.trial_will_end: syncs and logs notification', async () => {
    await handler.handle(
      makeEvent('customer.subscription.trial_will_end', makeSub({ trial_end: 9999 })),
    );
    expect(subs.syncFromStripeEvent).toHaveBeenCalled();
  });

  it('customer.subscription.pending_update_applied: syncs', async () => {
    await handler.handle(makeEvent('customer.subscription.pending_update_applied', makeSub()));
    expect(subs.syncFromStripeEvent).toHaveBeenCalled();
  });

  it('customer.subscription.pending_update_expired: logs only — no sync', async () => {
    await handler.handle(makeEvent('customer.subscription.pending_update_expired', makeSub()));
    expect(subs.syncFromStripeEvent).not.toHaveBeenCalled();
  });

  it('propagates errors from SubscriptionsService (so BullMQ retries)', async () => {
    subs.syncFromStripeEvent.mockRejectedValue(new Error('customer not found yet'));
    await expect(
      handler.handle(makeEvent('customer.subscription.created', makeSub())),
    ).rejects.toThrow('customer not found yet');
  });
});
