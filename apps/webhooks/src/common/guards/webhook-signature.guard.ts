import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import Stripe from 'stripe';
import { StripeService } from '../../stripe/stripe.service';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      Request & { rawBody?: Buffer; stripeEvent?: Stripe.Event; correlationId?: string }
    >();

    const signature = request.headers['stripe-signature'] as string;
    const rawBody = request.rawBody;

    if (!signature) {
      this.logger.warn({
        message: 'Webhook request missing stripe-signature header',
        correlationId: request.correlationId,
        ip: request.ip,
      });
      throw new BadRequestException('Missing stripe-signature header');
    }

    if (!rawBody) {
      this.logger.warn({
        message: 'Webhook request missing raw body',
        correlationId: request.correlationId,
      });
      throw new BadRequestException('Raw body not available');
    }

    const webhookSecret = this.configService.get<string>('stripe.webhookSecret')!;

    try {
      const event = this.stripeService.constructWebhookEvent(
        rawBody,
        signature,
        webhookSecret,
      );
      request.stripeEvent = event;
      return true;
    } catch (err) {
      this.logger.warn({
        message: 'Webhook signature verification failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        correlationId: request.correlationId,
        ip: request.ip,
      });
      throw new BadRequestException('Invalid webhook signature');
    }
  }
}
