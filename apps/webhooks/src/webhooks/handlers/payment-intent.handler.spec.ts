import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentIntentHandler } from './payment-intent.handler';
import { PaymentIntentsService } from '../../payment-intents/payment-intents.service';
import { AuditService } from '../../audit/audit.service';

interface MockPaymentIntentsService {
  updateStatus: jest.Mock;
}
interface MockAuditService {
  log: jest.Mock;
}

const makePi = (overrides: Partial<Stripe.PaymentIntent> = {}): Stripe.PaymentIntent =>
  ({
    id: 'pi_1',
    status: 'requires_payment_method',
    amount: 2000,
    currency: 'usd',
    amount_capturable: 0,
    amount_received: 0,
    next_action: null,
    cancellation_reason: null,
    last_payment_error: null,
    ...overrides,
  } as unknown as Stripe.PaymentIntent);

const makeEvent = (type: string, object: Stripe.PaymentIntent): Stripe.Event =>
  ({ id: 'evt_1', type, data: { object } } as unknown as Stripe.Event);

describe('PaymentIntentHandler', () => {
  let handler: PaymentIntentHandler;
  let pis: MockPaymentIntentsService;
  let audit: MockAuditService;

  beforeEach(async () => {
    pis = { updateStatus: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentIntentHandler,
        { provide: PaymentIntentsService, useValue: pis },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    handler = module.get<PaymentIntentHandler>(PaymentIntentHandler);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('payment_intent.succeeded', () => {
    it('updates status to succeeded and writes audit log', async () => {
      await handler.handle(makeEvent('payment_intent.succeeded', makePi({ status: 'succeeded' })));
      expect(pis.updateStatus).toHaveBeenCalledWith('pi_1', 'succeeded');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payment_intent.succeeded',
          resourceId: 'pi_1',
          status: 'success',
        }),
      );
    });
  });

  describe('payment_intent.payment_failed', () => {
    it('updates status with last_payment_error info and audits failure', async () => {
      const pi = makePi({
        last_payment_error: {
          code: 'card_declined',
          decline_code: 'generic_decline',
          message: 'Your card was declined.',
        } as unknown as Stripe.PaymentIntent.LastPaymentError,
      });
      await handler.handle(makeEvent('payment_intent.payment_failed', pi));
      expect(pis.updateStatus).toHaveBeenCalledWith(
        'pi_1',
        'requires_payment_method',
        'card_declined',
        'generic_decline',
        'Your card was declined.',
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payment_intent.payment_failed',
          status: 'failure',
        }),
      );
    });

    it('handles missing last_payment_error (undefined fields propagated)', async () => {
      await handler.handle(makeEvent('payment_intent.payment_failed', makePi()));
      expect(pis.updateStatus).toHaveBeenCalledWith(
        'pi_1',
        'requires_payment_method',
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('payment_intent.canceled', () => {
    it('updates status to canceled and audits failure', async () => {
      await handler.handle(
        makeEvent('payment_intent.canceled', makePi({ cancellation_reason: 'requested_by_customer' })),
      );
      expect(pis.updateStatus).toHaveBeenCalledWith('pi_1', 'canceled');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payment_intent.canceled', status: 'failure' }),
      );
    });
  });

  describe('payment_intent.processing', () => {
    it('updates status with next_action and amount_received', async () => {
      const pi = makePi({
        next_action: { type: 'redirect_to_url' } as unknown as Stripe.PaymentIntent.NextAction,
        amount_received: 500,
      });
      await handler.handle(makeEvent('payment_intent.processing', pi));
      expect(pis.updateStatus).toHaveBeenCalledWith(
        'pi_1',
        'processing',
        undefined,
        undefined,
        undefined,
        JSON.stringify(pi.next_action),
        500,
      );
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('handles null next_action', async () => {
      await handler.handle(makeEvent('payment_intent.processing', makePi({ next_action: null })));
      expect(pis.updateStatus).toHaveBeenCalledWith(
        'pi_1',
        'processing',
        undefined,
        undefined,
        undefined,
        undefined,
        0,
      );
    });
  });

  describe('payment_intent.requires_action', () => {
    it('updates status to requires_action', async () => {
      await handler.handle(makeEvent('payment_intent.requires_action', makePi()));
      expect(pis.updateStatus).toHaveBeenCalledWith('pi_1', 'requires_action');
    });
  });

  describe('payment_intent.amount_capturable_updated', () => {
    it('logs only — no DB write', async () => {
      await handler.handle(
        makeEvent('payment_intent.amount_capturable_updated', makePi({ amount_capturable: 1500 })),
      );
      expect(pis.updateStatus).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('error propagation', () => {
    it('propagates errors from PaymentIntentsService (so BullMQ retries)', async () => {
      pis.updateStatus.mockRejectedValue(new Error('db down'));
      await expect(
        handler.handle(makeEvent('payment_intent.succeeded', makePi())),
      ).rejects.toThrow('db down');
    });
  });
});
