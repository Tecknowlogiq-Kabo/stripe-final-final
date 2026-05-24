import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { StripeSubscription } from './stripe-subscription.entity';

@Entity({ name: 'BILLING_RECORDS' })
export class BillingRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'SUBSCRIPTION_ID', type: 'varchar2', length: 36 })
  subscriptionId: string;

  @ManyToOne(() => StripeSubscription, (sub) => sub.billingRecords)
  @JoinColumn({ name: 'SUBSCRIPTION_ID' })
  subscription: StripeSubscription;

  @Column({ name: 'CHARGE_AMOUNT', type: 'number' })
  chargeAmount: number;

  @Column({ name: 'CURRENCY', type: 'varchar2', length: 3, default: 'usd' })
  currency: string;

  @Column({ name: 'STATUS', type: 'varchar2', length: 20, default: 'pending' })
  status: string;

  @Column({ name: 'PERIOD_DATE', type: 'timestamp' })
  periodDate: Date;

  @Column({ name: 'LOCKED_AT', type: 'timestamp', nullable: true })
  lockedAt?: Date;

  @Column({ name: 'CHARGED_AT', type: 'timestamp', nullable: true })
  chargedAt?: Date;

  @Column({ name: 'STRIPE_PAYMENT_INTENT_ID', type: 'varchar2', length: 100, nullable: true })
  stripePaymentIntentId?: string;

  @Column({ name: 'FAILURE_MESSAGE', type: 'varchar2', length: 4000, nullable: true })
  failureMessage?: string;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT', type: 'timestamp' })
  updatedAt: Date;
}
