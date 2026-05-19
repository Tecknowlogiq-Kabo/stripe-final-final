import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { trace, SpanStatusCode } from '@opentelemetry/api';

/**
 * Thin wrapper around the Stripe SDK with OpenTelemetry span instrumentation.
 *
 * Every Stripe API call (create, retrieve, update, list, del) is wrapped in a
 * child span so Tempo shows Stripe latency on the trace waterfall.
 * Span attributes: stripe.resource (e.g. 'paymentIntents'), stripe.method (e.g. 'create').
 * Errors set span status to ERROR and record the Stripe error type/request_id.
 */
@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('stripe.secretKey');
    if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');

    this.stripe = new Stripe(secretKey, {
      apiVersion: this.configService.get<string>('stripe.apiVersion') as Stripe.LatestApiVersion,
      typescript: true,
      maxNetworkRetries: 2,
      telemetry: false,
    });

    this.logger.log('Stripe SDK initialized');
  }

  // ── Resource accessors ──────────────────────────────────────────────────
  // Each getter returns a proxy that wraps every method call in an OTel span.

  get customers(): Stripe.CustomersResource {
    return this.wrapResource(this.stripe.customers, 'customers');
  }
  get paymentIntents(): Stripe.PaymentIntentsResource {
    return this.wrapResource(this.stripe.paymentIntents, 'paymentIntents');
  }
  get setupIntents(): Stripe.SetupIntentsResource {
    return this.wrapResource(this.stripe.setupIntents, 'setupIntents');
  }
  get paymentMethods(): Stripe.PaymentMethodsResource {
    return this.wrapResource(this.stripe.paymentMethods, 'paymentMethods');
  }
  get subscriptions(): Stripe.SubscriptionsResource {
    return this.wrapResource(this.stripe.subscriptions, 'subscriptions');
  }
  get webhooks(): Stripe.Webhooks {
    return this.wrapResource(this.stripe.webhooks, 'webhooks');
  }
  get confirmationTokens(): Stripe.ConfirmationTokensResource {
    return this.wrapResource(this.stripe.confirmationTokens, 'confirmationTokens');
  }
  get customerSessions(): Stripe.CustomerSessionsResource {
    return this.wrapResource(this.stripe.customerSessions, 'customerSessions');
  }
  get prices(): Stripe.PricesResource {
    return this.wrapResource(this.stripe.prices, 'prices');
  }
  get billingPortal() {
    return this.wrapResource(this.stripe.billingPortal, 'billingPortal');
  }
  get products(): Stripe.ProductsResource {
    return this.wrapResource(this.stripe.products, 'products');
  }
  get invoices(): Stripe.InvoicesResource {
    return this.wrapResource(this.stripe.invoices, 'invoices');
  }

  /** @deprecated Use constructWebhookEvent below which includes OTel span. */
  get stripeInstance(): Stripe {
    return this.stripe;
  }

  // ── Webhook construction (with span) ────────────────────────────────────

  constructWebhookEvent(payload: Buffer, signature: string, secret: string, tolerance?: number): Stripe.Event {
    return this.traceStripeCall('webhooks', 'constructEvent', () =>
      this.stripe.webhooks.constructEvent(payload, signature, secret, tolerance ?? 300),
    );
  }

  // ── OTel span wrapper ───────────────────────────────────────────────────

  /**
   * Wraps a Stripe resource object in a Proxy so every method call
   * (create, retrieve, update, list, del, etc.) is traced.
   */
  private wrapResource<T extends object>(resource: T, resourceName: string): T {
    const self = this;
    return new Proxy(resource, {
      get(target, method: string) {
        const original = (target as Record<string, unknown>)[method];
        if (typeof original !== 'function') return original;
        return (...args: unknown[]) => self.traceStripeCall(resourceName, method, () => original.apply(target, args));
      },
    });
  }

  private traceStripeCall<T>(resource: string, method: string, fn: () => T): T {
    const tracer = trace.getTracer('stripe-sdk');
    const span = tracer.startSpan(`stripe.${resource}.${method}`, {
      attributes: { 'stripe.resource': resource, 'stripe.method': method },
    });
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result
          .then((v) => { span.setStatus({ code: SpanStatusCode.OK }); span.end(); return v; })
          .catch((err) => { this.recordStripeError(span, err); span.end(); throw err; }) as T;
      }
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (err) {
      this.recordStripeError(span, err);
      span.end();
      throw err;
    }
  }

  private recordStripeError(span: { setStatus: (s: { code: SpanStatusCode; message?: string }) => void; setAttribute: (k: string, v: string | number) => void }, err: unknown): void {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
    if (err instanceof Stripe.errors.StripeError) {
      span.setAttribute('stripe.error.type', err.type);
      if (err.code) span.setAttribute('stripe.error.code', err.code);
      if (err.requestId) span.setAttribute('stripe.request_id', err.requestId);
    }
  }
}
