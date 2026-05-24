import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentMethodHandler } from './payment-method.handler';
import { PaymentMethodsService } from '../../payment-methods/payment-methods.service';
import { AuditService } from '../../audit/audit.service';

interface MockPaymentMethodsService {
  upsertFromStripeEvent: jest.Mock;
  removeByStripeId: jest.Mock;
}
interface MockAuditService {
  log: jest.Mock;
}

const makePm = (overrides: Partial<Stripe.PaymentMethod> = {}): Stripe.PaymentMethod =>
  ({
    id: 'pm_1',
    type: 'card',
    customer: 'cus_1',
    ...overrides,
  } as unknown as Stripe.PaymentMethod);

const makeEvent = (
  type: string,
  object: Stripe.PaymentMethod,
  previous_attributes?: Record<string, unknown>,
): Stripe.Event =>
  ({
    id: 'evt_1',
    type,
    data: previous_attributes ? { object, previous_attributes } : { object },
  } as unknown as Stripe.Event);

describe('PaymentMethodHandler', () => {
  let handler: PaymentMethodHandler;
  let pms: MockPaymentMethodsService;
  let audit: MockAuditService;

  beforeEach(async () => {
    pms = {
      upsertFromStripeEvent: jest.fn().mockResolvedValue(undefined),
      removeByStripeId: jest.fn().mockResolvedValue(undefined),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodHandler,
        { provide: PaymentMethodsService, useValue: pms },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    handler = module.get<PaymentMethodHandler>(PaymentMethodHandler);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('payment_method.attached: upserts and audits', async () => {
    await handler.handle(makeEvent('payment_method.attached', makePm()));
    expect(pms.upsertFromStripeEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'pm_1' }));
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment_method.attached', status: 'success' }),
    );
  });

  it('payment_method.updated: upserts without audit', async () => {
    await handler.handle(makeEvent('payment_method.updated', makePm()));
    expect(pms.upsertFromStripeEvent).toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('payment_method.detached: removes and audits', async () => {
    await handler.handle(makeEvent('payment_method.detached', makePm()));
    expect(pms.removeByStripeId).toHaveBeenCalledWith('pm_1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment_method.detached', status: 'success' }),
    );
  });

  it('payment_method.card_automatically_updated: upserts and logs previous attrs', async () => {
    await handler.handle(
      makeEvent('payment_method.card_automatically_updated', makePm(), { card: { last4: '0000' } }),
    );
    expect(pms.upsertFromStripeEvent).toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('unhandled event types do nothing', async () => {
    await handler.handle(makeEvent('payment_method.bogus', makePm()));
    expect(pms.upsertFromStripeEvent).not.toHaveBeenCalled();
    expect(pms.removeByStripeId).not.toHaveBeenCalled();
  });

  it('propagates errors from PaymentMethodsService.upsertFromStripeEvent (so BullMQ retries)', async () => {
    pms.upsertFromStripeEvent.mockRejectedValue(new Error('customer not found yet'));
    await expect(
      handler.handle(makeEvent('payment_method.attached', makePm())),
    ).rejects.toThrow('customer not found yet');
  });

  it('propagates errors from PaymentMethodsService.removeByStripeId', async () => {
    pms.removeByStripeId.mockRejectedValue(new Error('db down'));
    await expect(
      handler.handle(makeEvent('payment_method.detached', makePm())),
    ).rejects.toThrow('db down');
  });
});
