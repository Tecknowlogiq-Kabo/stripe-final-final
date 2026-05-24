import { Injectable } from '@nestjs/common';
import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly httpRequestDuration: Histogram;
  private readonly httpErrorsTotal: Counter;
  private readonly httpRequestsTotal: Counter;

  // Business metrics — incremented by services at the relevant call sites.
  private readonly paymentIntentCreatedTotal: Counter;
  private readonly paymentIntentSucceededTotal: Counter;
  private readonly paymentIntentFailedTotal: Counter;
  private readonly subscriptionCreatedTotal: Counter;

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

    this.paymentIntentCreatedTotal = new Counter({
      name: 'payment_intent_created_total',
      help: 'Total PaymentIntents created',
      labelNames: ['currency', 'payment_method_type'],
    });

    this.paymentIntentSucceededTotal = new Counter({
      name: 'payment_intent_succeeded_total',
      help: 'Total PaymentIntents that reached the succeeded state',
      labelNames: ['currency'],
    });

    this.paymentIntentFailedTotal = new Counter({
      name: 'payment_intent_failed_total',
      help: 'Total PaymentIntents that failed (payment_failed / requires_payment_method after error)',
      labelNames: ['currency', 'decline_code'],
    });

    this.subscriptionCreatedTotal = new Counter({
      name: 'subscription_created_total',
      help: 'Total Stripe subscriptions created',
      labelNames: ['plan_id'],
    });
  }

  recordRequestDuration(method: string, route: string, statusCode: number, durationSeconds: number): void {
    this.httpRequestDuration.observe({ method, route, status_code: String(statusCode) }, durationSeconds);
    this.httpRequestsTotal.inc({ method, route, status_code: String(statusCode) });
  }

  recordError(method: string, route: string, statusCode: number): void {
    this.httpErrorsTotal.inc({ method, route, status_code: String(statusCode) });
  }

  incrementPaymentIntentCreated(currency: string, paymentMethodType: string): void {
    this.paymentIntentCreatedTotal.inc({ currency, payment_method_type: paymentMethodType });
  }

  incrementPaymentIntentSucceeded(currency: string): void {
    this.paymentIntentSucceededTotal.inc({ currency });
  }

  incrementPaymentIntentFailed(currency: string, declineCode: string): void {
    this.paymentIntentFailedTotal.inc({ currency, decline_code: declineCode });
  }

  incrementSubscriptionCreated(planId: string): void {
    this.subscriptionCreatedTotal.inc({ plan_id: planId });
  }

  async getMetrics(): Promise<string> {
    return register.metrics();
  }
}
