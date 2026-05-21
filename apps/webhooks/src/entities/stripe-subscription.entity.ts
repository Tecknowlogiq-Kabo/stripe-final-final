import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { StripeCustomer } from './stripe-customer.entity';

@Entity({ name: 'STRIPE_SUBSCRIPTIONS' })
export class StripeSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'STRIPE_SUB_ID', type: 'varchar2', length: 100 })
  stripeSubscriptionId: string;

  @Column({ name: 'STATUS', type: 'varchar2', length: 50 })
  status: string;

  @Column({ name: 'CURRENT_PERIOD_START', type: 'timestamp', nullable: true })
  currentPeriodStart?: Date;

  @Column({ name: 'CURRENT_PERIOD_END', type: 'timestamp', nullable: true })
  currentPeriodEnd?: Date;

  @Column({ name: 'CANCEL_AT_PERIOD_END', type: 'number', width: 1, default: 0 })
  cancelAtPeriodEnd: boolean;

  @Column({ name: 'TRIAL_END', type: 'timestamp', nullable: true })
  trialEnd?: Date;

  @Column({ name: 'TRIAL_START', type: 'timestamp', nullable: true })
  trialStart?: Date;

  @Column({ name: 'STRIPE_PRICE_ID', type: 'varchar2', length: 100 })
  stripePriceId: string;

  @Column({ name: 'DEFAULT_PM_ID', type: 'varchar2', length: 100, nullable: true })
  defaultPaymentMethodId?: string;

  @Column({ name: 'CUSTOMER_ID', type: 'varchar2', length: 36 })
  customerId: string;

  @ManyToOne(() => StripeCustomer, (c) => c.subscriptions)
  @JoinColumn({ name: 'CUSTOMER_ID' })
  customer: StripeCustomer;

  @Column({ name: 'METADATA', type: 'clob', nullable: true })
  metadata?: string;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT', type: 'timestamp' })
  updatedAt: Date;
}
