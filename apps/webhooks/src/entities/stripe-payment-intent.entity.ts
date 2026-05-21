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

@Entity({ name: 'STRIPE_PAYMENT_INTENTS' })
export class StripePaymentIntent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'STRIPE_PI_ID', type: 'varchar2', length: 100 })
  stripePaymentIntentId: string;

  @Column({ name: 'AMOUNT', type: 'number', precision: 15, scale: 0 })
  amount: number;

  @Column({ name: 'CURRENCY', type: 'varchar2', length: 3 })
  currency: string;

  @Column({ name: 'STATUS', type: 'varchar2', length: 50 })
  status: string;

  @Column({ name: 'CLIENT_SECRET', type: 'varchar2', length: 500 })
  clientSecret: string;

  @Column({ name: 'CUSTOMER_ID', type: 'varchar2', length: 36, nullable: true })
  customerId?: string;

  @ManyToOne(() => StripeCustomer, (c) => c.paymentIntents)
  @JoinColumn({ name: 'CUSTOMER_ID' })
  customer: StripeCustomer;

  @Column({ name: 'STRIPE_PM_ID', type: 'varchar2', length: 100, nullable: true })
  stripePaymentMethodId?: string;

  @Column({ name: 'IDEMPOTENCY_KEY', type: 'varchar2', length: 255, nullable: true })
  idempotencyKey?: string;

  @Column({ name: 'METADATA', type: 'clob', nullable: true })
  metadata?: string;

  @Column({ name: 'DESCRIPTION', type: 'varchar2', length: 4000, nullable: true })
  description?: string;

  @Column({ name: 'ERROR_CODE', type: 'varchar2', length: 100, nullable: true })
  errorCode?: string;

  @Column({ name: 'ERROR_DECLINE_CODE', type: 'varchar2', length: 100, nullable: true })
  errorDeclineCode?: string;

  @Column({ name: 'ERROR_MESSAGE', type: 'varchar2', length: 4000, nullable: true })
  errorMessage?: string;

  @Column({ name: 'SETUP_FUTURE_USAGE', type: 'varchar2', length: 20, nullable: true })
  setupFutureUsage?: string;

  @Column({ name: 'NEXT_ACTION', type: 'clob', nullable: true })
  nextAction?: string;

  @Column({ name: 'PAYMENT_METHOD_TYPES', type: 'varchar2', length: 500, nullable: true })
  paymentMethodTypes?: string;

  @Column({ name: 'AMOUNT_RECEIVED', type: 'number', precision: 15, scale: 0, nullable: true })
  amountReceived?: number;

  @Column({ name: 'AMOUNT_CAPTURABLE', type: 'number', precision: 15, scale: 0, nullable: true })
  amountCapturable?: number;

  @Column({ name: 'RECEIPT_EMAIL', type: 'varchar2', length: 255, nullable: true })
  receiptEmail?: string;

  @Column({ name: 'STATEMENT_DESCRIPTOR', type: 'varchar2', length: 22, nullable: true })
  statementDescriptor?: string;

  @Column({ name: 'LIVEMODE', type: 'number', width: 1, default: 0 })
  livemode: boolean;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT', type: 'timestamp' })
  updatedAt: Date;
}
