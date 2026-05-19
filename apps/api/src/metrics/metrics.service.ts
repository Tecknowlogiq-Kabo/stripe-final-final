import { Injectable } from '@nestjs/common';
import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly httpRequestDuration: Histogram;
  private readonly httpErrorsTotal: Counter;
  private readonly httpRequestsTotal: Counter;

  constructor() {
    // Collect Node.js runtime metrics (event loop lag, heap, GC, etc.)
    collectDefaultMetrics({ prefix: 'stripe_' });

    this.httpRequestDuration = new Histogram({
      name: 'stripe_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });

    this.httpErrorsTotal = new Counter({
      name: 'stripe_http_errors_total',
      help: 'Total HTTP errors by status code',
      labelNames: ['method', 'route', 'status_code'],
    });

    this.httpRequestsTotal = new Counter({
      name: 'stripe_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });
  }

  recordRequestDuration(method: string, route: string, statusCode: number, durationSeconds: number): void {
    this.httpRequestDuration.observe({ method, route, status_code: String(statusCode) }, durationSeconds);
    this.httpRequestsTotal.inc({ method, route, status_code: String(statusCode) });
  }

  recordError(method: string, route: string, statusCode: number): void {
    this.httpErrorsTotal.inc({ method, route, status_code: String(statusCode) });
  }

  async getMetrics(): Promise<string> {
    return register.metrics();
  }
}
