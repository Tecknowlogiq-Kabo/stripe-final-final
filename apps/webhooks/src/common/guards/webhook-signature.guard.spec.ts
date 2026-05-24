import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { StripeService } from '../../stripe/stripe.service';

interface MockStripeService {
  constructWebhookEvent: jest.Mock;
}
interface MockConfigService {
  get: jest.Mock;
}

const makeContext = (
  headers: Record<string, string | undefined>,
  rawBody?: Buffer,
): ExecutionContext => {
  const request: Record<string, unknown> = { headers, rawBody, ip: '127.0.0.1', correlationId: 'cid-1' };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
};

describe('WebhookSignatureGuard', () => {
  let guard: WebhookSignatureGuard;
  let stripe: MockStripeService;
  let config: MockConfigService;

  beforeEach(async () => {
    stripe = { constructWebhookEvent: jest.fn() };
    config = { get: jest.fn().mockReturnValue('whsec_test') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookSignatureGuard,
        { provide: StripeService, useValue: stripe },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    guard = module.get(WebhookSignatureGuard);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('valid signature: attaches stripeEvent to request and returns true', () => {
    const fakeEvent = { id: 'evt_1', type: 'payment_intent.succeeded' } as unknown as Stripe.Event;
    stripe.constructWebhookEvent.mockReturnValue(fakeEvent);

    const rawBody = Buffer.from('{}');
    const ctx = makeContext({ 'stripe-signature': 'sig' }, rawBody);
    const req = ctx.switchToHttp().getRequest<{ stripeEvent?: Stripe.Event }>();

    expect(guard.canActivate(ctx)).toBe(true);
    expect(stripe.constructWebhookEvent).toHaveBeenCalledWith(rawBody, 'sig', 'whsec_test');
    expect(req.stripeEvent).toBe(fakeEvent);
  });

  it('missing signature header: throws BadRequestException', () => {
    const ctx = makeContext({}, Buffer.from('{}'));
    expect(() => guard.canActivate(ctx)).toThrow(BadRequestException);
    expect(() => guard.canActivate(ctx)).toThrow('Missing stripe-signature header');
  });

  it('missing rawBody: throws BadRequestException', () => {
    const ctx = makeContext({ 'stripe-signature': 'sig' });
    expect(() => guard.canActivate(ctx)).toThrow(BadRequestException);
    expect(() => guard.canActivate(ctx)).toThrow('Raw body not available');
  });

  it('invalid signature: throws BadRequestException with generic message', () => {
    stripe.constructWebhookEvent.mockImplementation(() => {
      throw new Error('Signature mismatch');
    });
    const ctx = makeContext({ 'stripe-signature': 'sig' }, Buffer.from('{}'));
    expect(() => guard.canActivate(ctx)).toThrow(BadRequestException);
    expect(() => guard.canActivate(ctx)).toThrow('Invalid webhook signature');
  });

  it('non-Error thrown from Stripe SDK is still wrapped', () => {
    stripe.constructWebhookEvent.mockImplementation(() => {
      throw 'string-error';
    });
    const ctx = makeContext({ 'stripe-signature': 'sig' }, Buffer.from('{}'));
    expect(() => guard.canActivate(ctx)).toThrow(BadRequestException);
  });
});
