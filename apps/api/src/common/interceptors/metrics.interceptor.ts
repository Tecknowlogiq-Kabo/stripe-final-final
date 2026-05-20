import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from '../../metrics/metrics.service';

/**
 * Records HTTP request duration, count, and errors per route.
 *
 * Uses process.hrtime() for monotonic timing (immune to clock skew).
 * Normalizes route paths to prevent label cardinality explosion
 * (e.g. /api/v1/customers/abc123 → /api/v1/customers/:id).
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = process.hrtime.bigint();
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    // request.route?.path is the NestJS-resolved path pattern (e.g. /api/v1/customers/:id).
    // Falls back to 'unknown' if route hasn't resolved yet (rare edge case).
    const route = request.route?.path ?? 'unknown';

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          const duration = Number(process.hrtime.bigint() - start) / 1e9;
          this.metrics.recordRequestDuration(method, route, response.statusCode, duration);
        },
        error: (err) => {
          const statusCode = err?.status ?? err?.statusCode ?? 500;
          const duration = Number(process.hrtime.bigint() - start) / 1e9;
          this.metrics.recordRequestDuration(method, route, statusCode, duration);
          this.metrics.recordError(method, route, statusCode);
        },
      }),
    );
  }
}
