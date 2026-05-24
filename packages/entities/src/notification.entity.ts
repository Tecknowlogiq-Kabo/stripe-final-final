import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { StripeCustomer } from './stripe-customer.entity';

@Entity({ name: 'NOTIFICATIONS' })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'CUSTOMER_ID', type: 'varchar2', length: 36 })
  customerId: string;

  @ManyToOne(() => StripeCustomer)
  @JoinColumn({ name: 'CUSTOMER_ID' })
  customer: StripeCustomer;

  @Column({ name: 'TYPE', type: 'varchar2', length: 50 })
  type: string;

  @Column({ name: 'TITLE', type: 'varchar2', length: 255 })
  title: string;

  @Column({ name: 'MESSAGE', type: 'varchar2', length: 4000 })
  message: string;

  @Column({ name: 'IS_READ', type: 'number', width: 1, default: 0 })
  isRead: boolean;

  @Column({ name: 'METADATA', type: 'clob', nullable: true })
  metadata?: string;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;
}
