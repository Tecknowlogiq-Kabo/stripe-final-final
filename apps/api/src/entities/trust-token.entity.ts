import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type TrustTokenStatus = 'pending' | 'submitted' | 'approved' | 'denied' | 'expired';

@Entity({ name: 'TRUST_TOKENS' })
export class TrustToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'TOKEN_HASH', type: 'varchar2', length: 128 })
  tokenHash: string;

  @Column({ name: 'RESOURCE_TYPE', type: 'varchar2', length: 50 })
  resourceType: string;

  @Column({ name: 'RESOURCE_ID', type: 'varchar2', length: 100, nullable: true })
  resourceId?: string;

  @Column({
    name: 'STATUS',
    type: 'varchar2',
    length: 20,
    default: 'pending',
  })
  status: TrustTokenStatus;

  @Column({ name: 'EXPIRES_AT', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'USER_ID', type: 'varchar2', length: 36, nullable: true })
  userId?: string;

  @Column({ name: 'CREATED_BY', type: 'varchar2', length: 100, nullable: true })
  createdBy?: string;

  @Column({ name: 'METADATA', type: 'varchar2', length: 4000, nullable: true })
  metadata?: string;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT', type: 'timestamp' })
  updatedAt: Date;
}
