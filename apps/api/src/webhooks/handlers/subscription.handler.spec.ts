import { Test, TestingModule } from '@nestjs/testing';
import Stripe from 'stripe';
import { SubscriptionHandler } from './subscription.handler';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

describe('SubscriptionHandler', () => {
  let handler: SubscriptionHandler;
  let subscriptionsService: { syncFromStripeEvent: jest.Mock };

  beforeEach(async () => {
    subscriptionsService = {
      syncFromStripeEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionHandler,
        { provide: SubscriptionsService, useValue: subscriptionsService },
      ],
    }).compile();

    handler = module.get<SubscriptionHandler>(SubscriptionHandler);
  });

  function buildEvent(
    type: string,
    sub: Partial<Stripe.Subscription> & { id: string },
  ): Stripe.Event {
    return {
      id: `evt_${type}`,
      type,
      data: { object: sub as Stripe.Subscription },
    } as unknown as Stripe.Event;
  }

  // Implementation note: the handler routes created/updated/deleted/paused/resumed
  // through the same syncFromStripeEvent path. The service decides what to
  // persist based on subscription.status — this keeps the handler thin.
  describe.each([
    ['customer.subscription.created', 'incomplete'],
    ['customer.subscription.updated', 'active'],
    ['customer.subscription.deleted', 'canceled'],
    ['customer.subscription.paused', 'paused'],
    ['customer.subscription.resumed', 'active'],
  ])('%s', (eventType, status) => {
    it(`forwards subscription to syncFromStripeEvent`, async () => {
      const sub = { id: 'sub_1', status: status as Stripe.Subscription.Status };

      await handler.handle(buildEvent(eventType, sub));

      expect(subscriptionsService.syncFromStripeEvent).toHaveBeenCalledTimes(1);
      expect(subscriptionsService.syncFromStripeEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_1', status }),
      );
    });
  });

  describe('customer.subscription.trial_will_end', () => {
    it('still syncs the subscription so trial dates stay current', async () => {
      await handler.handle(
        buildEvent('customer.subscription.trial_will_end', {
          id: 'sub_trial',
          status: 'trialing',
          trial_end: 1700000000,
        }),
      );

      expect(subscriptionsService.syncFromStripeEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_trial' }),
      );
    });
  });

  describe('customer.subscription.pending_update_expired', () => {
    it('does NOT call sync — pending update never applied so no DB change needed', async () => {
      await handler.handle(
        buildEvent('customer.subscription.pending_update_expired', {
          id: 'sub_pending',
          status: 'active',
        }),
      );

      expect(subscriptionsService.syncFromStripeEvent).not.toHaveBeenCalled();
    });
  });

  describe('unknown event type', () => {
    it('is a no-op and does not throw', async () => {
      await expect(
        handler.handle(
          buildEvent('customer.subscription.totally_made_up', {
            id: 'sub_x',
            status: 'active',
          }),
        ),
      ).resolves.toBeUndefined();
      expect(subscriptionsService.syncFromStripeEvent).not.toHaveBeenCalled();
    });
  });
});
