import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { WebhooksService } from './webhooks.service';
import { WEBHOOK_QUEUE } from './webhook-queue.constants';
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
  let queueAddMock: jest.Mock;
  let paymentIntentHandler: { handle: jest.Mock };

  beforeEach(async () => {
    queryMock = jest.fn();
    queueAddMock = jest.fn().mockResolvedValue({ id: 'job-1' });
    paymentIntentHandler = { handle: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: DataSource, useValue: { query: queryMock } },
        { provide: getQueueToken(WEBHOOK_QUEUE), useValue: { add: queueAddMock } },
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
    it('skips already processed events without enqueueing', async () => {
      queryMock.mockResolvedValueOnce([{ id: 'rec-1', status: 'processed', retryCount: 0 }]);

      await service.processEvent(makeEvent());

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queueAddMock).not.toHaveBeenCalled();
    });

    it('inserts new event record and enqueues job for unknown event id', async () => {
      queryMock
        .mockResolvedValueOnce([])  // SELECT: no existing
        .mockResolvedValueOnce({}); // INSERT

      await service.processEvent(makeEvent());

      const insertCall = queryMock.mock.calls[1];
      expect(insertCall[0]).toContain('INSERT INTO STRIPE_WEBHOOK_EVENTS');
      expect(insertCall[1][1]).toBe('evt_test123');
      expect(insertCall[1][2]).toBe('payment_intent.succeeded');
      expect(insertCall[1][4]).toBe('pending');

      expect(queueAddMock).toHaveBeenCalledWith(
        WEBHOOK_QUEUE,
        expect.objectContaining({ eventId: 'evt_test123' }),
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('updates existing failed event record and enqueues retry', async () => {
      queryMock
        .mockResolvedValueOnce([{ id: 'rec-1', status: 'failed', retryCount: 2 }])
        .mockResolvedValueOnce({}); // UPDATE

      await service.processEvent(makeEvent());

      const updateCall = queryMock.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE STRIPE_WEBHOOK_EVENTS');
      expect(updateCall[1][3]).toBe(0); // reset retry count

      expect(queueAddMock).toHaveBeenCalledWith(
        WEBHOOK_QUEUE,
        expect.objectContaining({ eventId: 'evt_test123', recordId: 'rec-1' }),
        expect.anything(),
      );
    });
  });

  describe('execute', () => {
    const recordId = 'rec-abc';
    const eventId = 'evt_test123';
    const event = makeEvent({ type: 'payment_intent.succeeded' });

    it('dispatches to the correct handler and marks event processed', async () => {
      queryMock
        .mockResolvedValueOnce([{ payload: JSON.stringify(event) }]) // SELECT payload
        .mockResolvedValueOnce({}); // UPDATE processed

      await service.execute(eventId, recordId);

      expect(paymentIntentHandler.handle).toHaveBeenCalledTimes(1);

      const processedUpdate = queryMock.mock.calls[1];
      expect(processedUpdate[1][0]).toBe('processed');
      expect(processedUpdate[1][1]).toBe(recordId);
    });

    it('marks event failed and rethrows when handler throws', async () => {
      paymentIntentHandler.handle.mockRejectedValue(new Error('Boom'));
      queryMock
        .mockResolvedValueOnce([{ payload: JSON.stringify(event) }]) // SELECT payload
        .mockResolvedValueOnce({}); // UPDATE failed

      await expect(service.execute(eventId, recordId)).rejects.toThrow('Boom');

      const failedUpdate = queryMock.mock.calls[1];
      expect(failedUpdate[1][0]).toBe('failed');
      expect(failedUpdate[1][1]).toBe('Boom');
      expect(failedUpdate[1][2]).toBe(recordId);
    });

    it('logs warning and marks processed for unhandled event types', async () => {
      const unknownEvent = makeEvent({ type: 'charge.updated' });
      queryMock
        .mockResolvedValueOnce([{ payload: JSON.stringify(unknownEvent) }])
        .mockResolvedValueOnce({});

      await service.execute(eventId, recordId);

      const finalUpdate = queryMock.mock.calls[1];
      expect(finalUpdate[1][0]).toBe('processed');
    });
  });
});
