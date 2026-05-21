import {
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import Stripe from 'stripe';
import { WebhooksService } from './webhooks.service';
import { WebhookSignatureGuard } from '../common/guards/webhook-signature.guard';
import { StripeEvent } from '../common/decorators/stripe-event.decorator';

// Webhook endpoints must NOT be rate-limited (no throttler)
// Stripe requires guaranteed delivery.
// No @Public() needed — no global auth guard in this app.

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

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
