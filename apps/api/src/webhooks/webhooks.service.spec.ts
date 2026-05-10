import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { WebhooksService } from './webhooks.service';
import { PaymentIntentHandler } from './handlers/payment-intent.handler';
import { SetupIntentHandler } from './handlers/setup-intent.handler';
import { SubscriptionHandler } from './handlers/subscription.handler';
import { InvoiceHandler } from './handlers/invoice.handler';
import { PaymentMethodHandler } from './handlers/payment-method.handler';
import { CustomerHandler } from './handlers/customer.handler';
import { MandateHandler } from './handlers/mandate.handler';

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
  let queryMock: jest.Mock;
  let paymentIntentHandler: { handle: jest.Mock };

  beforeEach(async () => {
    queryMock = jest.fn();
    paymentIntentHandler = { handle: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: DataSource, useValue: { query: queryMock } },
        { provide: PaymentIntentHandler, useValue: paymentIntentHandler },
        { provide: SetupIntentHandler, useValue: { handle: jest.fn() } },
        { provide: SubscriptionHandler, useValue: { handle: jest.fn() } },
        { provide: InvoiceHandler, useValue: { handle: jest.fn() } },
        { provide: PaymentMethodHandler, useValue: { handle: jest.fn() } },
        { provide: CustomerHandler, useValue: { handle: jest.fn() } },
        { provide: MandateHandler, useValue: { handle: jest.fn() } },
      ],
    }).compile();

    service = module.get(WebhooksService);
  });

  describe('processEvent', () => {
    it('skips already processed events', async () => {
      queryMock.mockResolvedValueOnce([{ id: 'rec-1', status: 'processed', retryCount: 0 }]);

      await service.processEvent(makeEvent());

      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('inserts new event record for unknown event id', async () => {
      queryMock
        .mockResolvedValueOnce([]) // No existing
        .mockResolvedValueOnce({}) // INSERT
        .mockResolvedValueOnce([]); // UPDATE to processed

      await service.processEvent(makeEvent());

      const insertCall = queryMock.mock.calls[1];
      expect(insertCall[0]).toContain('INSERT INTO STRIPE_WEBHOOK_EVENTS');
      expect(insertCall[1][1]).toBe('evt_test123');
      expect(insertCall[1][2]).toBe('payment_intent.succeeded');
      expect(insertCall[1][4]).toBe('pending');
    });

    it('updates existing failed event for retry', async () => {
      queryMock
        .mockResolvedValueOnce([{ id: 'rec-1', status: 'failed', retryCount: 2 }])
        .mockResolvedValueOnce({}) // UPDATE
        .mockResolvedValueOnce([]); // UPDATE to processed

      await service.processEvent(makeEvent());

      const updateCall = queryMock.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE STRIPE_WEBHOOK_EVENTS');
      expect(updateCall[1][3]).toBe(0);
    });

    it('dispatches to correct handler based on event type', async () => {
      queryMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce([]);

      await service.processEvent(makeEvent({ type: 'payment_intent.succeeded' }));

      expect(paymentIntentHandler.handle).toHaveBeenCalledTimes(1);
    });

    it('logs warning for unhandled event types and still marks processed', async () => {
      queryMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce([]);

      await service.processEvent(makeEvent({ type: 'charge.updated' }));

      const finalUpdate = queryMock.mock.calls[queryMock.mock.calls.length - 1];
      expect(finalUpdate[1][0]).toBe('processed');
    });

    it('marks event as failed with error message when handler throws', async () => {
      paymentIntentHandler.handle.mockRejectedValue(new Error('Boom'));
      queryMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({});

      await expect(
        service.processEvent(makeEvent({ type: 'payment_intent.succeeded' })),
      ).rejects.toThrow('Boom');

      const failedUpdate = queryMock.mock.calls[queryMock.mock.calls.length - 1];
      expect(failedUpdate[1][0]).toBe('failed');
      expect(failedUpdate[1][1]).toBe('Boom');
    });
  });
});
