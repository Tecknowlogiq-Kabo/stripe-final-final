import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Generates a per-request correlation ID for distributed tracing.
 *
 * - Attaches `correlationId` to the Express request object so guards,
 *   handlers, and downstream services can include it in logs.
 * - Sets `X-Correlation-Id` on the response so upstream callers (Stripe,
 *   TrustID) and load balancers can correlate the request end-to-end.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(
    req: Request & { correlationId?: string },
    res: Response,
    next: NextFunction,
  ): void {
    const correlationId = randomUUID();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);
    next();
  }
}
