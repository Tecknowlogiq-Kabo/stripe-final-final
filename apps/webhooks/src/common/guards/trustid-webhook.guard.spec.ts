import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrustIdWebhookGuard } from './trustid-webhook.guard';

interface MockConfigService {
  get: jest.Mock;
}

const makeContext = (headers: Record<string, string | undefined>): ExecutionContext => {
  const request = { headers, ip: '127.0.0.1' };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('TrustIdWebhookGuard', () => {
  let guard: TrustIdWebhookGuard;
  let config: MockConfigService;

  beforeEach(async () => {
    config = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrustIdWebhookGuard,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    guard = module.get(TrustIdWebhookGuard);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('correct secret: returns true', () => {
    config.get.mockImplementation((key: string) => (key === 'trustid.webhookSecret' ? 'super-secret' : undefined));
    const ctx = makeContext({ 'x-trustid-secret': 'super-secret' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('wrong secret: throws UnauthorizedException with mismatch message', () => {
    config.get.mockImplementation((key: string) => (key === 'trustid.webhookSecret' ? 'super-secret' : undefined));
    const ctx = makeContext({ 'x-trustid-secret': 'wrong' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('Invalid webhook secret');
  });

  it('missing header: throws UnauthorizedException', () => {
    config.get.mockImplementation((key: string) => (key === 'trustid.webhookSecret' ? 'super-secret' : undefined));
    const ctx = makeContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('Missing x-trustid-secret header');
  });

  it('different-length secrets: rejected (timing-safe length check)', () => {
    config.get.mockImplementation((key: string) => (key === 'trustid.webhookSecret' ? 'short' : undefined));
    const ctx = makeContext({ 'x-trustid-secret': 'much-longer-secret' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('no secret configured in production: rejects all requests', () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'trustid.webhookSecret') return undefined;
      if (key === 'NODE_ENV') return 'production';
      return undefined;
    });
    const ctx = makeContext({ 'x-trustid-secret': 'whatever' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('TrustID webhook endpoint not configured');
  });

  it('no secret configured in development: warns and allows', () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'trustid.webhookSecret') return undefined;
      if (key === 'NODE_ENV') return 'development';
      return undefined;
    });
    const ctx = makeContext({});
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
