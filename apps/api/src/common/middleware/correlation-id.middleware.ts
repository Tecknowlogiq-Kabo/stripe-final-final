import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Resolves a correlation ID from incoming headers or generates a new UUID.
 *
 * Sets both `req.id` (read by pino-http's genReqId) and the response header
 * so callers can correlate traces across service boundaries.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string; correlationId?: string }, res: Response, next: NextFunction): void {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ??
      (req.headers['x-request-id'] as string) ??
      uuidv4();

    // pino-http reads req.id via genReqId — binds correlation ID to all log lines
    req.id = correlationId;
    // AllExceptionsFilter reads req.correlationId for structured error responses
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  }
}
