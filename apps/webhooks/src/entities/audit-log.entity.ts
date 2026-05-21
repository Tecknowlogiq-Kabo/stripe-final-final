import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity({ name: 'AUDIT_LOGS' })
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'ACTOR_ID', type: 'varchar2', length: 36 })
  actorId: string;

  @Column({ name: 'ACTOR_EMAIL', type: 'varchar2', length: 255, nullable: true })
  actorEmail: string | null;

  @Column({ name: 'ACTION', type: 'varchar2', length: 100 })
  action: string;

  @Column({ name: 'RESOURCE_TYPE', type: 'varchar2', length: 100 })
  resourceType: string;

  @Column({ name: 'RESOURCE_ID', type: 'varchar2', length: 36, nullable: true })
  resourceId: string | null;

  @Column({ name: 'DETAILS', type: 'clob', nullable: true })
  details: string | null;

  @Column({ name: 'IP_ADDRESS', type: 'varchar2', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ name: 'USER_AGENT', type: 'varchar2', length: 500, nullable: true })
  userAgent: string | null;

  @Column({ name: 'CORRELATION_ID', type: 'varchar2', length: 36, nullable: true })
  correlationId: string | null;

  @Column({ name: 'STATUS', type: 'varchar2', length: 20, default: 'success' })
  status: string;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;
}
