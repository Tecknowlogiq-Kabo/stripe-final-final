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

@Entity({ name: 'STRIPE_SETUP_INTENTS' })
export class StripeSetupIntent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'STRIPE_SI_ID', type: 'varchar2', length: 100 })
  stripeSetupIntentId: string;

  @Column({ name: 'STATUS', type: 'varchar2', length: 50 })
  status: string;

  @Column({ name: 'CLIENT_SECRET', type: 'varchar2', length: 500 })
  clientSecret: string;

  @ManyToOne(() => StripeCustomer, (c) => c.setupIntents)
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

  @Column({ name: 'PAYMENT_METHOD_TYPES', type: 'varchar2', length: 500, nullable: true })
  paymentMethodTypes?: string;

  @Column({ name: 'USAGE', type: 'varchar2', length: 20, nullable: true })
  usage?: string;

  @Column({ name: 'LAST_SETUP_ERROR', type: 'clob', nullable: true })
  lastSetupError?: string;

  @Column({ name: 'NEXT_ACTION', type: 'clob', nullable: true })
  nextAction?: string;

  @Column({ name: 'LIVEMODE', type: 'number', width: 1, default: 0 })
  livemode: boolean;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT', type: 'timestamp' })
  updatedAt: Date;
}
