import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const TIMEOUT_MS = 30_000;

/**
 * Enforces a 30-second response timeout on all routes.
 * Webhook routes should be excluded in app.module.ts (Stripe retries handle that).
 */
@Injectable()
export class RequestTimeoutMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({
          statusCode: 503,
          message: 'Request timeout',
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
