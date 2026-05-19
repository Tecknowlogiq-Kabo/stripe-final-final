import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import Stripe from 'stripe';

@Catch(Stripe.errors.StripeError)
export class StripeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(StripeExceptionFilter.name);

  catch(exception: Stripe.errors.StripeError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response & { locals?: Record<string, unknown> }>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();

    // Guard against double-response: if the RequestTimeoutMiddleware already sent
    // a 503, or if headers are already sent for any reason, log and return silently.
    if (response.headersSent || response.locals?.timedOut) {
      this.logger.warn({
        message: 'StripeExceptionFilter: response already sent (timeout or double-fire)',
        stripeRequestId: exception.requestId,
        correlationId: request.correlationId,
        path: request.url,
      });
      return;
    }

    // ALWAYS log Stripe request_id — required for Stripe support correlation
    this.logger.error({
      message: 'Stripe API error',
      stripeRequestId: exception.requestId,
      stripeErrorType: exception.type,
      stripeErrorCode: exception.code,
      correlationId: request.correlationId,
      path: request.url,
      method: request.method,
      ...(exception instanceof Stripe.errors.StripeCardError && {
        declineCode: exception.decline_code,
      }),
    });

    let status: number;
    let userMessage: string;
    let shouldRetry = false;

    if (exception instanceof Stripe.errors.StripeCardError) {
      // 402 Payment Required — safe to expose decline_code to user
      status = HttpStatus.PAYMENT_REQUIRED;
      userMessage = exception.decline_code
        ? `Payment declined: ${exception.decline_code.replace(/_/g, ' ')}`
        : exception.message;
    } else if (exception instanceof Stripe.errors.StripeInvalidRequestError) {
      status = HttpStatus.BAD_REQUEST;
      userMessage = 'Invalid payment request. Please check your input.';
    } else if (exception instanceof Stripe.errors.StripeIdempotencyError) {
      status = HttpStatus.CONFLICT;
      userMessage = 'Duplicate request detected. Please use a new idempotency key.';
    } else if (exception instanceof Stripe.errors.StripeAuthenticationError) {
      // NEVER expose auth errors to clients — log internally only
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      userMessage = 'Payment service configuration error. Please contact support.';
    } else if (exception instanceof Stripe.errors.StripePermissionError) {
      status = HttpStatus.FORBIDDEN;
      userMessage = 'Payment service permission error.';
    } else if (exception instanceof Stripe.errors.StripeRateLimitError) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      userMessage = 'Too many requests. Please retry shortly.';
      shouldRetry = true;
    } else if (exception instanceof Stripe.errors.StripeConnectionError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      userMessage = 'Payment service temporarily unavailable. Please retry.';
      shouldRetry = true;
    } else if (exception instanceof Stripe.errors.StripeAPIError) {
      status = HttpStatus.BAD_GATEWAY;
      userMessage = 'Payment gateway error. Please retry.';
      shouldRetry = true;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      userMessage = 'An unexpected payment error occurred.';
    }

    const responseBody: Record<string, unknown> = {
      statusCode: status,
      message: userMessage,
      stripeRequestId: exception.requestId,
      correlationId: request.correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (shouldRetry) {
      // Use Stripe's actual Retry-After if available, otherwise default to 30s.
      // The hardcoded 5s was dangerous — Stripe may need 30-60s to recover.
      const rawException = exception as unknown as Record<string, unknown>;
      const stripeRetryAfter = (rawException?.headers as Record<string, string> | undefined)?.['retry-after'];
      const retrySeconds = stripeRetryAfter ? parseInt(stripeRetryAfter, 10) : 30;
      response.setHeader('Retry-After', String(retrySeconds));
      responseBody.retryAfter = retrySeconds;
    }

    response.status(status).json(responseBody);
  }
}
