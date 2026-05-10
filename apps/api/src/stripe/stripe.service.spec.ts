import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';

describe('StripeService', () => {
  let service: StripeService;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn((key: string) => {
      if (key === 'stripe.secretKey') return 'sk_test_fake';
      if (key === 'stripe.apiVersion') return '2026-03-25.dahlia';
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = module.get(StripeService);
  });

  it('throws when STRIPE_SECRET_KEY is missing', async () => {
    configGet.mockImplementation((key: string) => {
      if (key === 'stripe.secretKey') return undefined;
      return undefined;
    });

    await expect(
      Test.createTestingModule({
        providers: [
          StripeService,
          { provide: ConfigService, useValue: { get: configGet } },
        ],
      }).compile(),
    ).rejects.toThrow('STRIPE_SECRET_KEY is not configured');
  });

  it('exposes customers resource', () => {
    expect(service.customers).toBeDefined();
  });

  it('exposes paymentIntents resource', () => {
    expect(service.paymentIntents).toBeDefined();
  });

  it('exposes setupIntents resource', () => {
    expect(service.setupIntents).toBeDefined();
  });

  it('exposes paymentMethods resource', () => {
    expect(service.paymentMethods).toBeDefined();
  });

  it('exposes subscriptions resource', () => {
    expect(service.subscriptions).toBeDefined();
  });

  it('exposes webhooks resource', () => {
    expect(service.webhooks).toBeDefined();
  });

  it('exposes confirmationTokens resource', () => {
    expect(service.confirmationTokens).toBeDefined();
  });

  it('exposes customerSessions resource', () => {
    expect(service.customerSessions).toBeDefined();
  });

  it('exposes prices resource', () => {
    expect(service.prices).toBeDefined();
  });

  it('exposes products resource', () => {
    expect(service.products).toBeDefined();
  });

  it('exposes invoices resource', () => {
    expect(service.invoices).toBeDefined();
  });

  it('constructWebhookEvent delegates to stripe.webhooks.constructEvent', () => {
    const payload = Buffer.from('{}');
    const signature = 'sig_abc';
    const secret = 'whsec_test';

    const event = { id: 'evt_1', type: 'payment_intent.succeeded' };
    // Reach into the private stripe instance to verify delegation
    const stripeAny = (service as any).stripe;
    const constructSpy = jest.spyOn(stripeAny.webhooks, 'constructEvent').mockReturnValue(event);

    const result = service.constructWebhookEvent(payload, signature, secret);

    expect(constructSpy).toHaveBeenCalledWith(payload, signature, secret);
    expect(result).toBe(event);
  });
});
