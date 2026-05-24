import { Injectable, CanActivate } from '@nestjs/common';

/**
 * Blocks access in production environments.
 * Dev-only endpoints (test data creation, manual charge triggers) must
 * never be reachable in production.
 */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  canActivate(): boolean {
    return process.env.NODE_ENV !== 'production';
  }
}
