import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

/**
 * Restricts /metrics access to localhost and Docker bridge IPs.
 * Prometheus scrapes from the docker-compose LGTM stack on the same host,
 * so only 127.0.0.1 and 172.x.x.x (Docker bridge) are allowed.
 * No JWT or basic auth needed — IP allowlist is sufficient for EC2.
 */
@Injectable()
export class MetricsAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const ip = request.ip || request.connection?.remoteAddress || '';

    if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return true;
    if (ip.startsWith('172.')) return true; // Docker bridge
    return false;
  }
}
