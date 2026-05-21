import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Guards the TrustID webhook endpoint by verifying a shared secret header.
 *
 * TrustID Cloud can include custom headers via `ContainerEventCallbackHeaders`
 * when the guest link is created. This guard validates the presence of a
 * shared secret in those headers, providing basic authentication for the
 * otherwise-public webhook endpoint.
 *
 * The shared secret is configured as TRUSTID_WEBHOOK_SECRET.
 * TrustID must be configured to send: `{ "Header": "x-trustid-secret", "Value": "<secret>" }`
 */
@Injectable()
export class TrustIdWebhookGuard implements CanActivate {
  private readonly logger = new Logger(TrustIdWebhookGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const webhookSecret = this.configService.get<string>('trustid.webhookSecret');

    // If no secret is configured, allow all requests (dev mode or not configured)
    if (!webhookSecret) {
      this.logger.warn(
        'TRUSTID_WEBHOOK_SECRET not configured — TrustID webhooks are unauthenticated. Set the env var to secure this endpoint.',
      );
      return true;
    }

    const providedSecret = request.headers['x-trustid-secret'] as string;

    if (!providedSecret) {
      this.logger.warn({
        message: 'TrustID webhook request missing x-trustid-secret header',
        ip: request.ip,
      });
      throw new UnauthorizedException('Missing x-trustid-secret header');
    }

    // Constant-time comparison to prevent timing attacks
    if (!timingSafeEqual(providedSecret, webhookSecret)) {
      this.logger.warn({
        message: 'TrustID webhook secret mismatch',
        ip: request.ip,
      });
      throw new UnauthorizedException('Invalid webhook secret');
    }

    return true;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
