import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { InvoiceHandler } from './invoice.handler';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

interface MockSubscriptionsService {
  findByStripeId: jest.Mock;
  setStatus: jest.Mock;
}

const makeInvoice = (overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice =>
  ({
    id: 'in_test_1',
    subscription: 'sub_test_1',
    customer: 'cus_test_1',
    amount_due: 1000,
    amount_paid: 1000,
    currency: 'usd',
    status: 'open',
    attempt_count: 1,
    next_payment_attempt: null,
    due_date: null,
    paid_out_of_band: false,
    ...overrides,
  } as unknown as Stripe.Invoice);

const makeEvent = (type: string, object: Stripe.Invoice): Stripe.Event =>
  ({
    id: 'evt_1',
    type,
    data: { object },
  } as unknown as Stripe.Event);

describe('InvoiceHandler', () => {
  let handler: InvoiceHandler;
  let subs: MockSubscriptionsService;

  beforeEach(async () => {
    subs = {
      findByStripeId: jest.fn(),
      setStatus: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceHandler,
        { provide: SubscriptionsService, useValue: subs },
      ],
    }).compile();

    module.useLogger(false);
    handler = module.get<InvoiceHandler>(InvoiceHandler);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('invoice.created', () => {
    it('logs without DB writes', async () => {
      await handler.handle(makeEvent('invoice.created', makeInvoice()));
      expect(subs.findByStripeId).not.toHaveBeenCalled();
      expect(subs.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('invoice.finalized', () => {
    it('logs without DB writes', async () => {
      await handler.handle(makeEvent('invoice.finalized', makeInvoice()));
      expect(subs.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('invoice.payment_succeeded', () => {
    it('reactivates non-active subscription', async () => {
      subs.findByStripeId.mockResolvedValue({ id: 'sub-uuid', status: 'past_due' });
      await handler.handle(makeEvent('invoice.payment_succeeded', makeInvoice()));
      expect(subs.findByStripeId).toHaveBeenCalledWith('sub_test_1');
      expect(subs.setStatus).toHaveBeenCalledWith('sub-uuid', 'active');
    });

    it('does not change status when subscription already active', async () => {
      subs.findByStripeId.mockResolvedValue({ id: 'sub-uuid', status: 'active' });
      await handler.handle(makeEvent('invoice.payment_succeeded', makeInvoice()));
      expect(subs.setStatus).not.toHaveBeenCalled();
    });

    it('does nothing if no subscription on invoice', async () => {
      await handler.handle(
        makeEvent('invoice.payment_succeeded', makeInvoice({ subscription: null as unknown as string })),
      );
      expect(subs.findByStripeId).not.toHaveBeenCalled();
    });

    it('re-throws when subscription status update fails (so BullMQ retries)', async () => {
      subs.findByStripeId.mockRejectedValue(new Error('db down'));
      await expect(
        handler.handle(makeEvent('invoice.payment_succeeded', makeInvoice())),
      ).rejects.toThrow('db down');
    });
  });

  describe('invoice.payment_failed', () => {
    it('marks active subscription past_due', async () => {
      subs.findByStripeId.mockResolvedValue({ id: 'sub-uuid', status: 'active' });
      await handler.handle(makeEvent('invoice.payment_failed', makeInvoice()));
      expect(subs.setStatus).toHaveBeenCalledWith('sub-uuid', 'past_due');
    });

    it('does not transition non-active subscription', async () => {
      subs.findByStripeId.mockResolvedValue({ id: 'sub-uuid', status: 'past_due' });
      await handler.handle(makeEvent('invoice.payment_failed', makeInvoice()));
      expect(subs.setStatus).not.toHaveBeenCalled();
    });

    it('swallows error (already in failure path, logger captures)', async () => {
      subs.findByStripeId.mockRejectedValue(new Error('db down'));
      await expect(
        handler.handle(makeEvent('invoice.payment_failed', makeInvoice())),
      ).resolves.toBeUndefined();
    });
  });

  describe('invoice.upcoming', () => {
    it('logs only', async () => {
      await handler.handle(makeEvent('invoice.upcoming', makeInvoice()));
      expect(subs.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('invoice.paid', () => {
    it('reactivates past_due subscription', async () => {
      subs.findByStripeId.mockResolvedValue({ id: 'sub-uuid', status: 'past_due' });
      await handler.handle(makeEvent('invoice.paid', makeInvoice()));
      expect(subs.setStatus).toHaveBeenCalledWith('sub-uuid', 'active');
    });

    it('does not change already-active subscription', async () => {
      subs.findByStripeId.mockResolvedValue({ id: 'sub-uuid', status: 'active' });
      await handler.handle(makeEvent('invoice.paid', makeInvoice()));
      expect(subs.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('invoice.voided', () => {
    it('logs only', async () => {
      await handler.handle(makeEvent('invoice.voided', makeInvoice()));
      expect(subs.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('invoice.marked_uncollectible', () => {
    it('marks active subscription as unpaid', async () => {
      subs.findByStripeId.mockResolvedValue({ id: 'sub-uuid', status: 'active' });
      await handler.handle(makeEvent('invoice.marked_uncollectible', makeInvoice()));
      expect(subs.setStatus).toHaveBeenCalledWith('sub-uuid', 'unpaid');
    });

    it('marks past_due subscription as unpaid', async () => {
      subs.findByStripeId.mockResolvedValue({ id: 'sub-uuid', status: 'past_due' });
      await handler.handle(makeEvent('invoice.marked_uncollectible', makeInvoice()));
      expect(subs.setStatus).toHaveBeenCalledWith('sub-uuid', 'unpaid');
    });

    it('does nothing for canceled subscription', async () => {
      subs.findByStripeId.mockResolvedValue({ id: 'sub-uuid', status: 'canceled' });
      await handler.handle(makeEvent('invoice.marked_uncollectible', makeInvoice()));
      expect(subs.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('unhandled event types', () => {
    it('is a no-op', async () => {
      await handler.handle(makeEvent('invoice.something_else', makeInvoice()));
      expect(subs.findByStripeId).not.toHaveBeenCalled();
      expect(subs.setStatus).not.toHaveBeenCalled();
    });
  });
});
