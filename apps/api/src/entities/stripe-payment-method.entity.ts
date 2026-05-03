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

@Entity({ name: 'STRIPE_PAYMENT_METHODS' })
export class StripePaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'STRIPE_PM_ID', type: 'varchar2', length: 100 })
  stripePaymentMethodId: string;

  @Column({ name: 'TYPE', type: 'varchar2', length: 50 })
  type: string;

  @Column({ name: 'LAST4', type: 'varchar2', length: 4, nullable: true })
  last4?: string;

  @Column({ name: 'BRAND', type: 'varchar2', length: 50, nullable: true })
  brand?: string;

  @Column({ name: 'EXP_MONTH', type: 'number', precision: 2, nullable: true })
  expMonth?: number;

  @Column({ name: 'EXP_YEAR', type: 'number', precision: 4, nullable: true })
  expYear?: number;

  @Column({ name: 'FINGERPRINT', type: 'varchar2', length: 100, nullable: true })
  fingerprint?: string;

  @ManyToOne(() => StripeCustomer, (c) => c.paymentMethods)
  @JoinColumn({ name: 'CUSTOMER_ID' })
  customer: StripeCustomer;

  @Column({ name: 'IS_DEFAULT', type: 'number', width: 1, default: 0 })
  isDefault: boolean;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT', type: 'timestamp' })
  updatedAt: Date;
}
