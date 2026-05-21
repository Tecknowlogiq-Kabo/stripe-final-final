import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';

/**
 * Extracts the verified Stripe event from the request.
 * Must be used after WebhookSignatureGuard.
 *
 * Usage: @StripeEvent() event: Stripe.Event
 */
export const StripeEvent = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Stripe.Event => {
    const request = ctx.switchToHttp().getRequest<
      Request & { stripeEvent?: Stripe.Event }
    >();
    return request.stripeEvent!;
  },
);
