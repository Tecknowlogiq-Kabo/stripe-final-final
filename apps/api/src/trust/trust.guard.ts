import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Request } from 'express';
import { TrustService } from './trust.service';

/**
 * Validates a trustId from query param (`?trustId=...`) or
 * `Authorization: Bearer <trustId>` header.
 *
 * On success, attaches the decoded payload to `request.trustPayload`.
 */
@Injectable()
export class TrustGuard implements CanActivate {
  constructor(private readonly trustService: TrustService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const trustId = this.extractTrustId(request);

    if (!trustId) return false;

    const payload = await this.trustService.validateTrustToken(trustId);
    if (!payload) return false;

    (request as any).trustPayload = payload;
    return true;
  }

  private extractTrustId(request: Request): string | null {
    // 1. Query param: ?trustId=eyJ...
    const query = (request.query as Record<string, string | undefined>).trustId;
    if (query) return query;

    // 2. Authorization header: Bearer <trustId>
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      return auth.slice(7);
    }

    return null;
  }
}
