import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity({ name: 'SUBSCRIPTION_PLANS' })
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'STRIPE_PRICE_ID', type: 'varchar2', length: 100 })
  stripePriceId: string;

  @Column({ name: 'STRIPE_PRODUCT_ID', type: 'varchar2', length: 100 })
  stripeProductId: string;

  @Column({ name: 'NAME', type: 'varchar2', length: 255 })
  name: string;

  @Column({ name: 'DESCRIPTION', type: 'varchar2', length: 4000, nullable: true })
  description?: string;

  @Column({ name: 'AMOUNT', type: 'number', precision: 15, scale: 0 })
  amount: number;

  @Column({ name: 'CURRENCY', type: 'varchar2', length: 3, default: 'usd' })
  currency: string;

  @Column({ name: 'INTERVAL_TYPE', type: 'varchar2', length: 20 })
  interval: string;

  @Column({ name: 'INTERVAL_COUNT', type: 'number', default: 1 })
  intervalCount: number;

  @Column({ name: 'IS_ACTIVE', type: 'number', width: 1, default: 1 })
  isActive: boolean;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT', type: 'timestamp' })
  updatedAt: Date;
}
