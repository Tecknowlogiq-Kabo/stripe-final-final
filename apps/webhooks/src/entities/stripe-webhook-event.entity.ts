import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type WebhookEventStatus = 'pending' | 'processed' | 'failed' | 'skipped';

@Entity({ name: 'STRIPE_WEBHOOK_EVENTS' })
export class StripeWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'STRIPE_EVENT_ID', type: 'varchar2', length: 100 })
  stripeEventId: string;

  @Column({ name: 'EVENT_TYPE', type: 'varchar2', length: 100 })
  eventType: string;

  @Column({ name: 'PAYLOAD', type: 'clob' })
  payload: string;

  @Column({
    name: 'STATUS',
    type: 'varchar2',
    length: 20,
    default: 'pending',
  })
  status: WebhookEventStatus;

  @Column({ name: 'ERROR_MESSAGE', type: 'varchar2', length: 4000, nullable: true })
  errorMessage?: string;

  @Column({ name: 'RETRY_COUNT', type: 'number', default: 0 })
  retryCount: number;

  @Column({ name: 'PROCESSED_AT', type: 'timestamp', nullable: true })
  processedAt?: Date;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT', type: 'timestamp' })
  updatedAt: Date;
}
