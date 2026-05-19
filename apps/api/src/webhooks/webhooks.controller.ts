import {
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import Stripe from 'stripe';
import { WebhooksService } from './webhooks.service';
import { WebhookSignatureGuard } from '../common/guards/webhook-signature.guard';
import { StripeEvent } from '../common/decorators/stripe-event.decorator';
import { Public } from '../auth/decorators/public.decorator';

// Webhook endpoints must NOT be rate-limited.
// Stripe requires guaranteed delivery — rate limiting can cause 429s,
// which Stripe interprets as transient failures and retries up to 3 days before disabling the endpoint.
// @SkipThrottle() explicitly opts this controller out of the global ThrottlerGuard.
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Public()
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WebhookSignatureGuard)
  async handleStripeWebhook(@StripeEvent() event: Stripe.Event) {
    this.logger.log({
      message: 'Webhook received',
      eventId: event.id,
      eventType: event.type,
    });

    await this.webhooksService.processEvent(event);
    return { received: true };
  }
}
