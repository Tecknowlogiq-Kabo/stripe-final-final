import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Extends ThrottlerGuard to prefer user ID over IP address for rate-limit keys.
 *
 * Default behavior: per-IP rate limiting. In a corporate NAT environment,
 * 50 users sharing one IP would share 1 rate limit (e.g., 2 req/min each for auth).
 *
 * This guard generates keys as:
 *   - Authenticated: `user:<userId>` — each user gets their own budget
 *   - Anonymous:     `ip:<ipAddress>` — fallback to IP-based limiting
 */
@Injectable()
export class PerUserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as { id?: string } | undefined;
    if (user?.id) {
      return `user:${user.id}`;
    }
    // Fallback to IP-based tracking for unauthenticated requests
    const ip = (req['ip'] as string) ?? (req['ips'] as string[])?.[0] ?? 'unknown';
    return `ip:${ip}`;
  }
}
