import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { BillingRecord } from '../entities/billing-record.entity';
import { StripeService } from '../stripe/stripe.service';
import { BillingRecordRepository } from './billing-record.repository';
import { NotificationRepository } from './notification.repository';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly billingRecordRepo: BillingRecordRepository,
    private readonly notificationRepo: NotificationRepository,
    private readonly stripeService: StripeService,
  ) {}

  /** Lock all pending billing records for the current month. Runs daily at 5pm. */
  @Cron('0 17 * * *')
  async lockBillingAmounts(): Promise<{ locked: number }> {
    this.logger.log('Running lockBillingAmounts cron');
    const pending = await this.billingRecordRepo.findPendingForCurrentMonth();
    if (pending.length === 0) return { locked: 0 };

    const ids = pending.map((r) => r.billingRecord.id);
    await this.billingRecordRepo.lockAll(ids);

    this.logger.log({ message: 'Billing amounts locked', count: ids.length });
    return { locked: ids.length };
  }

  /** Charge all locked billing records. Runs on the 5th of each month at 3am. */
  @Cron('0 3 5 * *')
  async processMonthlyCharges(): Promise<{ charged: number; failed: number }> {
    this.logger.log('Running processMonthlyCharges cron');
    const locked = await this.billingRecordRepo.findLockedForCurrentMonth();

    let charged = 0;
    let failed = 0;

    for (const { billingRecord, subscription, customer } of locked) {
      try {
        const pi = await this.stripeService.paymentIntents.create({
          amount: billingRecord.chargeAmount,
          currency: billingRecord.currency,
          customer: customer.stripeCustomerId,
          payment_method: subscription.defaultPaymentMethodId ?? undefined,
          confirm: true,
          off_session: true,
        });

        await this.billingRecordRepo.markCharged(billingRecord.id, pi.id);
        charged++;
        this.logger.log({
          message: 'Billing record charged',
          billingRecordId: billingRecord.id,
          stripePaymentIntentId: pi.id,
        });
      } catch (err: any) {
        await this.billingRecordRepo.markFailed(billingRecord.id, err.message ?? 'Unknown error');

        const amountFormatted = `${(billingRecord.chargeAmount / 100).toFixed(2)} ${billingRecord.currency.toUpperCase()}`;
        await this.notificationRepo.insert(
          randomUUID(),
          subscription.customerId,
          'payment_failed',
          'Payment Failed',
          `Your subscription payment of ${amountFormatted} failed: ${err.message ?? 'Unknown error'}`,
        ).catch((notifErr: Error) =>
          this.logger.error({ message: 'Failed to insert payment_failed notification', error: notifErr.message }),
        );

        failed++;
        this.logger.error({
          message: 'Billing record charge failed',
          billingRecordId: billingRecord.id,
          error: err.message,
        });
      }
    }

    return { charged, failed };
  }

  /** Dev-only: create a billing record for a subscription. */
  async createBillingRecord(
    subscriptionId: string,
    chargeAmount: number,
    currency = 'usd',
  ): Promise<BillingRecord> {
    const id = randomUUID();
    const periodDate = new Date();
    periodDate.setDate(1);
    periodDate.setHours(0, 0, 0, 0);

    await this.billingRecordRepo.insert(id, subscriptionId, chargeAmount, currency, periodDate);

    const record = await this.billingRecordRepo.findBySubscriptionId(subscriptionId);
    const created = record.find((r) => r.id === id);
    if (!created) throw new NotFoundException(`Billing record ${id} not found after insert`);
    return created;
  }

  /** Dev-only: immediately trigger a charge for a subscription's most recent billing record. */
  async triggerChargeForSubscription(subscriptionId: string): Promise<{
    status: string;
    stripePaymentIntentId?: string;
    error?: string;
  }> {
    const records = await this.billingRecordRepo.findBySubscriptionId(subscriptionId);
    const record = records[0];
    if (!record) throw new NotFoundException(`No billing records found for subscription ${subscriptionId}`);

    const locked = await this.billingRecordRepo.findLockedForCurrentMonth();
    const lockedEntry = locked.find((l) => l.billingRecord.id === record.id);

    // If the record is not already locked, find its relations via pending
    const pending = await this.billingRecordRepo.findPendingForCurrentMonth();
    const entry = lockedEntry ?? pending.find((p) => p.billingRecord.id === record.id);

    if (!entry) {
      return { status: 'skipped', error: 'Record is not in pending or locked state for the current month' };
    }

    const { billingRecord, subscription, customer } = entry;

    try {
      const pi = await this.stripeService.paymentIntents.create({
        amount: billingRecord.chargeAmount,
        currency: billingRecord.currency,
        customer: customer.stripeCustomerId,
        payment_method: subscription.defaultPaymentMethodId ?? undefined,
        confirm: true,
        off_session: true,
      });

      await this.billingRecordRepo.markCharged(billingRecord.id, pi.id);
      this.logger.log({ message: 'Dev trigger charge succeeded', billingRecordId: billingRecord.id });
      return { status: 'charged', stripePaymentIntentId: pi.id };
    } catch (err: any) {
      await this.billingRecordRepo.markFailed(billingRecord.id, err.message ?? 'Unknown error');

      const amountFormatted = `${(billingRecord.chargeAmount / 100).toFixed(2)} ${billingRecord.currency.toUpperCase()}`;
      await this.notificationRepo.insert(
        randomUUID(),
        subscription.customerId,
        'payment_failed',
        'Payment Failed',
        `Your subscription payment of ${amountFormatted} failed: ${err.message ?? 'Unknown error'}`,
      ).catch((notifErr: Error) =>
        this.logger.error({ message: 'Failed to insert payment_failed notification', error: notifErr.message }),
      );

      return { status: 'failed', error: err.message };
    }
  }
}
