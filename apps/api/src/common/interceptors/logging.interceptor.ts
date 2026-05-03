import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { correlationId?: string }>();
    const { method, url, correlationId } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          const ms = Date.now() - start;
          this.logger.log({
            message: 'Request completed',
            method,
            url,
            statusCode: res.statusCode,
            durationMs: ms,
            correlationId,
          });
        },
        error: (err: Error) => {
          const ms = Date.now() - start;
          this.logger.warn({
            message: 'Request failed',
            method,
            url,
            durationMs: ms,
            correlationId,
            error: err.message,
          });
        },
      }),
    );
  }
}
