import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { SetupIntentHandler } from './setup-intent.handler';
import { SetupIntentsService } from '../../setup-intents/setup-intents.service';
import { AuditService } from '../../audit/audit.service';

interface MockSetupIntentsService {
  updateStatus: jest.Mock;
}
interface MockAuditService {
  log: jest.Mock;
}

const makeSi = (overrides: Partial<Stripe.SetupIntent> = {}): Stripe.SetupIntent =>
  ({
    id: 'seti_1',
    status: 'requires_payment_method',
    payment_method: null,
    customer: 'cus_1',
    last_setup_error: null,
    next_action: null,
    ...overrides,
  } as unknown as Stripe.SetupIntent);

const makeEvent = (type: string, object: Stripe.SetupIntent): Stripe.Event =>
  ({ id: 'evt_1', type, data: { object } } as unknown as Stripe.Event);

describe('SetupIntentHandler', () => {
  let handler: SetupIntentHandler;
  let sis: MockSetupIntentsService;
  let audit: MockAuditService;

  beforeEach(async () => {
    sis = { updateStatus: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupIntentHandler,
        { provide: SetupIntentsService, useValue: sis },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    handler = module.get<SetupIntentHandler>(SetupIntentHandler);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('setup_intent.succeeded: updates status with payment_method and audits', async () => {
    await handler.handle(
      makeEvent('setup_intent.succeeded', makeSi({ status: 'succeeded', payment_method: 'pm_1' })),
    );
    expect(sis.updateStatus).toHaveBeenCalledWith('seti_1', 'succeeded', 'pm_1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'setup_intent.succeeded', status: 'success' }),
    );
  });

  it('setup_intent.succeeded: payment_method may be null/undefined', async () => {
    await handler.handle(makeEvent('setup_intent.succeeded', makeSi({ status: 'succeeded' })));
    // null becomes undefined when cast to string | undefined via Stripe typing
    expect(sis.updateStatus).toHaveBeenCalledWith('seti_1', 'succeeded', null);
  });

  it('setup_intent.setup_failed: updates status and audits failure', async () => {
    const lastError = { code: 'authentication_required' } as unknown as Stripe.SetupIntent.LastSetupError;
    await handler.handle(makeEvent('setup_intent.setup_failed', makeSi({ last_setup_error: lastError })));
    expect(sis.updateStatus).toHaveBeenCalledWith(
      'seti_1',
      'requires_payment_method',
      undefined,
      JSON.stringify(lastError),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'setup_intent.setup_failed', status: 'failure' }),
    );
  });

  it('setup_intent.setup_failed: handles null last_setup_error', async () => {
    await handler.handle(makeEvent('setup_intent.setup_failed', makeSi()));
    expect(sis.updateStatus).toHaveBeenCalledWith(
      'seti_1',
      'requires_payment_method',
      undefined,
      undefined,
    );
  });

  it('setup_intent.canceled: updates status only', async () => {
    await handler.handle(makeEvent('setup_intent.canceled', makeSi()));
    expect(sis.updateStatus).toHaveBeenCalledWith('seti_1', 'canceled');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('setup_intent.requires_action: updates status', async () => {
    await handler.handle(
      makeEvent(
        'setup_intent.requires_action',
        makeSi({ next_action: { type: 'use_stripe_sdk' } as unknown as Stripe.SetupIntent.NextAction }),
      ),
    );
    expect(sis.updateStatus).toHaveBeenCalledWith('seti_1', 'requires_action');
  });

  it('propagates errors from SetupIntentsService (so BullMQ retries)', async () => {
    sis.updateStatus.mockRejectedValue(new Error('db down'));
    await expect(
      handler.handle(makeEvent('setup_intent.succeeded', makeSi())),
    ).rejects.toThrow('db down');
  });
});
