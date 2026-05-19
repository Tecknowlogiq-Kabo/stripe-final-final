import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_KEY, AuditMetadata } from '../../audit/audit.decorator';

/**
 * Intercepts requests on @Audit()-decorated handlers and records
 * an audit log entry after the handler completes successfully.
 *
 * Captures:
 *   - Actor ID + email from JWT
 *   - IP address + user agent from request
 *   - Correlation ID from middleware
 *   - Resource ID from the response body or route params
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<AuditMetadata | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{
      user?: { id: string; email: string };
      ip?: string;
      headers: { ['user-agent']?: string; ['x-correlation-id']?: string };
      params: Record<string, string>;
    }>();

    const actorId = request.user?.id ?? 'anonymous';
    const actorEmail = request.user?.email;
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers?.['user-agent'] ?? null;
    const correlationId = request.headers?.['x-correlation-id'] ?? null;

    return next.handle().pipe(
      tap({
        next: (responseBody: unknown) => {
          // Resolve the resource ID from response body or route params
          let resourceId: string | undefined;
          if (metadata.resourceIdPath) {
            const parts = metadata.resourceIdPath.split('.');
            let value: any = responseBody;
            for (const part of parts) {
              value = value?.[part];
            }
            resourceId = typeof value === 'string' ? value : request.params?.[metadata.resourceIdPath] ?? undefined;
          }

          this.auditService.log({
            actorId,
            actorEmail,
            action: metadata.action,
            resourceType: metadata.resourceType,
            resourceId,
            details: metadata.details,
            ipAddress,
            userAgent,
            correlationId,
            status: 'success',
          });
        },
        error: (_err: unknown) => {
          // Record failed attempts too
          this.auditService.log({
            actorId,
            actorEmail,
            action: metadata.action,
            resourceType: metadata.resourceType,
            resourceId: undefined,
            details: metadata.details,
            ipAddress,
            userAgent,
            correlationId,
            status: 'failure',
          });
        },
      }),
    );
  }
}
