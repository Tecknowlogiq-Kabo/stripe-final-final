import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { StripePaymentMethod } from './stripe-payment-method.entity';
import { StripePaymentIntent } from './stripe-payment-intent.entity';
import { StripeSetupIntent } from './stripe-setup-intent.entity';
import { StripeSubscription } from './stripe-subscription.entity';

@Entity({ name: 'STRIPE_CUSTOMERS' })
export class StripeCustomer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'STRIPE_CUSTOMER_ID', type: 'varchar2', length: 50 })
  stripeCustomerId: string;

  @Column({ name: 'EMAIL', type: 'varchar2', length: 255 })
  email: string;

  @Column({ name: 'NAME', type: 'varchar2', length: 255, nullable: true })
  name?: string;

  @Column({ name: 'PHONE', type: 'varchar2', length: 50, nullable: true })
  phone?: string;

  @Column({ name: 'METADATA', type: 'clob', nullable: true })
  metadata?: string;

  @Column({ name: 'IDEMPOTENCY_KEY', type: 'varchar2', length: 255, nullable: true })
  idempotencyKey?: string;

  @Column({ name: 'USER_ID', type: 'varchar2', length: 36, nullable: true })
  userId?: string;

  @Column({ name: 'IS_DELETED', type: 'number', width: 1, default: 0 })
  isDeleted: boolean;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT', type: 'timestamp' })
  updatedAt: Date;

  @OneToMany(() => StripePaymentMethod, (pm) => pm.customer)
  paymentMethods: StripePaymentMethod[];

  @OneToMany(() => StripePaymentIntent, (pi) => pi.customer)
  paymentIntents: StripePaymentIntent[];

  @OneToMany(() => StripeSetupIntent, (si) => si.customer)
  setupIntents: StripeSetupIntent[];

  @OneToMany(() => StripeSubscription, (s) => s.customer)
  subscriptions: StripeSubscription[];
}
