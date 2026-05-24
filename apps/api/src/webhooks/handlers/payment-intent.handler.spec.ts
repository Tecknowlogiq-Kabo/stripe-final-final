import { Test, TestingModule } from '@nestjs/testing';
import Stripe from 'stripe';
import { PaymentIntentHandler } from './payment-intent.handler';
import { PaymentIntentsService } from '../../payment-intents/payment-intents.service';

describe('PaymentIntentHandler', () => {
  let handler: PaymentIntentHandler;
  let paymentIntentsService: { updateStatus: jest.Mock };

  beforeEach(async () => {
    paymentIntentsService = {
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentIntentHandler,
        { provide: PaymentIntentsService, useValue: paymentIntentsService },
      ],
    }).compile();

    handler = module.get<PaymentIntentHandler>(PaymentIntentHandler);
  });

  function buildEvent(
    type: string,
    pi: Partial<Stripe.PaymentIntent> & { id: string },
  ): Stripe.Event {
    return {
      id: `evt_${type}`,
      type,
      data: { object: pi as Stripe.PaymentIntent },
    } as unknown as Stripe.Event;
  }

  describe('payment_intent.succeeded', () => {
    it('updates status to succeeded', async () => {
      await handler.handle(
        buildEvent('payment_intent.succeeded', {
          id: 'pi_success_1',
          status: 'succeeded',
        }),
      );

      expect(paymentIntentsService.updateStatus).toHaveBeenCalledWith(
        'pi_success_1',
        'succeeded',
      );
    });
  });

  describe('payment_intent.payment_failed', () => {
    it('updates status to requires_payment_method and forwards last_payment_error', async () => {
      await handler.handle(
        buildEvent('payment_intent.payment_failed', {
          id: 'pi_fail_1',
          status: 'requires_payment_method',
          last_payment_error: {
            code: 'card_declined',
            decline_code: 'insufficient_funds',
            message: 'Your card has insufficient funds.',
          } as Stripe.PaymentIntent.LastPaymentError,
        }),
      );

      expect(paymentIntentsService.updateStatus).toHaveBeenCalledWith(
        'pi_fail_1',
        'requires_payment_method',
        'card_declined',
        'insufficient_funds',
        'Your card has insufficient funds.',
      );
    });

    it('passes undefined error fields when last_payment_error missing', async () => {
      await handler.handle(
        buildEvent('payment_intent.payment_failed', {
          id: 'pi_fail_2',
          status: 'requires_payment_method',
        }),
      );

      expect(paymentIntentsService.updateStatus).toHaveBeenCalledWith(
        'pi_fail_2',
        'requires_payment_method',
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('payment_intent.canceled', () => {
    it('updates status to canceled', async () => {
      await handler.handle(
        buildEvent('payment_intent.canceled', {
          id: 'pi_cancel_1',
          status: 'canceled',
        }),
      );

      expect(paymentIntentsService.updateStatus).toHaveBeenCalledWith(
        'pi_cancel_1',
        'canceled',
      );
    });
  });

  describe('unknown event type', () => {
    it('is a no-op and does not throw', async () => {
      await expect(
        handler.handle(
          buildEvent('payment_intent.totally_made_up', {
            id: 'pi_unknown',
            status: 'succeeded',
          }),
        ),
      ).resolves.toBeUndefined();

      expect(paymentIntentsService.updateStatus).not.toHaveBeenCalled();
    });
  });
});
