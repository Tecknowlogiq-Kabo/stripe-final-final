import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { WebhooksService } from './webhooks.service';
import { WebhooksRepository } from './webhooks.repository';
import { WEBHOOK_QUEUE } from './webhook-queue.constants';
import { EncryptionService } from '../crypto/encryption.service';
import { PaymentIntentHandler } from './handlers/payment-intent.handler';
import { SetupIntentHandler } from './handlers/setup-intent.handler';
import { SubscriptionHandler } from './handlers/subscription.handler';
import { InvoiceHandler } from './handlers/invoice.handler';
import { PaymentMethodHandler } from './handlers/payment-method.handler';
import { CustomerHandler } from './handlers/customer.handler';
import { MandateHandler } from './handlers/mandate.handler';
import { ChargeHandler } from './handlers/charge.handler';
import { RadarHandler } from './handlers/radar.handler';
import { AccountHandler } from './handlers/account.handler';
import { CheckoutSessionHandler } from './handlers/checkout-session.handler';

function makeEvent(overrides: Partial<{ id: string; type: string }> = {}) {
  return {
    id: overrides.id ?? 'evt_test123',
    type: overrides.type ?? 'payment_intent.succeeded',
    object: 'event',
    api_version: '2026-03-25.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
    livemode: false,
    pending_webhooks: 0,
    request: null,
  } as any;
}

describe('WebhooksService', () => {
  let service: WebhooksService;
  let repoMock: Record<string, jest.Mock>;
  let queueAddMock: jest.Mock;
  let paymentIntentHandler: { handle: jest.Mock };

  beforeEach(async () => {
    repoMock = {
      findByStripeEventId: jest.fn(),
      insert: jest.fn(),
      updateForRetry: jest.fn(),
      getPayload: jest.fn(),
      markProcessed: jest.fn(),
      markFailed: jest.fn(),
    };
    queueAddMock = jest.fn().mockResolvedValue({ id: 'job-1' });
    paymentIntentHandler = { handle: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: WebhooksRepository, useValue: repoMock },
        { provide: getQueueToken(WEBHOOK_QUEUE), useValue: { add: queueAddMock } },
        { provide: PaymentIntentHandler, useValue: paymentIntentHandler },
        { provide: SetupIntentHandler, useValue: { handle: jest.fn() } },
        { provide: SubscriptionHandler, useValue: { handle: jest.fn() } },
        { provide: InvoiceHandler, useValue: { handle: jest.fn() } },
        { provide: PaymentMethodHandler, useValue: { handle: jest.fn() } },
        { provide: CustomerHandler, useValue: { handle: jest.fn() } },
        { provide: MandateHandler, useValue: { handle: jest.fn() } },
        { provide: ChargeHandler, useValue: { handle: jest.fn() } },
        { provide: RadarHandler, useValue: { handle: jest.fn() } },
        { provide: AccountHandler, useValue: { handle: jest.fn() } },
        { provide: CheckoutSessionHandler, useValue: { handle: jest.fn() } },
        {
          provide: EncryptionService,
          useValue: { encrypt: (s: string) => s, decrypt: (s: string) => s },
        },
      ],
    }).compile();

    service = module.get(WebhooksService);
  });

  describe('processEvent', () => {
    it('skips already processed events without enqueueing', async () => {
      repoMock.findByStripeEventId.mockResolvedValueOnce({ id: 'rec-1', status: 'processed', retryCount: 0 });

      await service.processEvent(makeEvent());

      expect(repoMock.findByStripeEventId).toHaveBeenCalledWith('evt_test123');
      expect(queueAddMock).not.toHaveBeenCalled();
    });

    it('inserts new event record and enqueues job for unknown event id', async () => {
      repoMock.findByStripeEventId.mockResolvedValueOnce(null);

      await service.processEvent(makeEvent());

      expect(repoMock.insert).toHaveBeenCalledWith(
        expect.any(String),
        'evt_test123',
        'payment_intent.succeeded',
        expect.any(String),
      );

      expect(queueAddMock).toHaveBeenCalledWith(
        WEBHOOK_QUEUE,
        expect.objectContaining({ eventId: 'evt_test123' }),
      );
    });

    it('updates existing failed event record and enqueues retry', async () => {
      repoMock.findByStripeEventId.mockResolvedValueOnce({ id: 'rec-1', status: 'failed', retryCount: 2 });

      await service.processEvent(makeEvent());

      expect(repoMock.updateForRetry).toHaveBeenCalledWith(
        'rec-1',
        'payment_intent.succeeded',
        expect.any(String),
      );

      expect(queueAddMock).toHaveBeenCalledWith(
        WEBHOOK_QUEUE,
        expect.objectContaining({ eventId: 'evt_test123', recordId: 'rec-1' }),
      );
    });
  });

  describe('execute', () => {
    const recordId = 'rec-abc';
    const eventId = 'evt_test123';
    const event = makeEvent({ type: 'payment_intent.succeeded' });

    it('dispatches to the correct handler and marks event processed', async () => {
      repoMock.getPayload.mockResolvedValueOnce(JSON.stringify(event));

      await service.execute(eventId, recordId);

      expect(paymentIntentHandler.handle).toHaveBeenCalledTimes(1);
      expect(repoMock.markProcessed).toHaveBeenCalledWith(recordId);
    });

    it('marks event failed and rethrows when handler throws', async () => {
      paymentIntentHandler.handle.mockRejectedValue(new Error('Boom'));
      repoMock.getPayload.mockResolvedValueOnce(JSON.stringify(event));

      await expect(service.execute(eventId, recordId)).rejects.toThrow('Boom');

      expect(repoMock.markFailed).toHaveBeenCalledWith(recordId, 'Boom');
    });

    it('logs warning and marks processed for unhandled event types', async () => {
      const unknownEvent = makeEvent({ type: 'charge.updated' });
      repoMock.getPayload.mockResolvedValueOnce(JSON.stringify(unknownEvent));

      await service.execute(eventId, recordId);

      expect(repoMock.markProcessed).toHaveBeenCalledWith(recordId);
    });
  });
});
