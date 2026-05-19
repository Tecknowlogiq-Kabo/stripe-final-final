import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from '../../metrics/metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = Date.now();
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const route = request.route?.path ?? 'unknown';

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          const duration = (Date.now() - start) / 1000;
          this.metrics.recordRequestDuration(method, route, response.statusCode, duration);
        },
        error: (err) => {
          const statusCode = err?.status ?? err?.statusCode ?? 500;
          const duration = (Date.now() - start) / 1000;
          this.metrics.recordRequestDuration(method, route, statusCode, duration);
          this.metrics.recordError(method, route, statusCode);
        },
      }),
    );
  }
}
