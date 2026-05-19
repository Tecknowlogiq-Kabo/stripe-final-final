import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const TIMEOUT_MS = 30_000;

/**
 * Enforces a 30-second response timeout on all routes.
 * Webhook routes should be excluded in app.module.ts (Stripe retries handle that).
 */
@Injectable()
export class RequestTimeoutMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response & { locals?: Record<string, unknown> }, next: NextFunction): void {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        // Mark response as timed out so StripeExceptionFilter and AllExceptionsFilter
        // know not to attempt a second response (prevents ERR_HTTP_HEADERS_SENT crash)
        res.locals = res.locals ?? {};
        res.locals.timedOut = true;
        res.status(503).json({
          statusCode: 503,
          message: 'Request timeout',
          correlationId: req.correlationId,
          timestamp: new Date().toISOString(),
          path: req.url,
        });
      }
    }, TIMEOUT_MS);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  }
}
