import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

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

  get customers(): Stripe.CustomersResource { return this.stripe.customers; }
  get paymentIntents(): Stripe.PaymentIntentsResource { return this.stripe.paymentIntents; }
  get setupIntents(): Stripe.SetupIntentsResource { return this.stripe.setupIntents; }
  get paymentMethods(): Stripe.PaymentMethodsResource { return this.stripe.paymentMethods; }
  get subscriptions(): Stripe.SubscriptionsResource { return this.stripe.subscriptions; }
  get webhooks(): Stripe.Webhooks { return this.stripe.webhooks; }
  get confirmationTokens(): Stripe.ConfirmationTokensResource { return this.stripe.confirmationTokens; }
  get customerSessions(): Stripe.CustomerSessionsResource { return this.stripe.customerSessions; }
  get prices(): Stripe.PricesResource { return this.stripe.prices; }
  get billingPortal() { return this.stripe.billingPortal; }
  get products(): Stripe.ProductsResource { return this.stripe.products; }
  get invoices(): Stripe.InvoicesResource { return this.stripe.invoices; }

  constructWebhookEvent(payload: Buffer, signature: string, secret: string, tolerance?: number): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, secret, tolerance ?? 300);
  }
}
