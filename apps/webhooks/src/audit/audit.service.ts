import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

export interface AuditEntry {
  actorId: string;
  actorEmail?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  status?: 'success' | 'failure';
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Records an audit entry. Fire-and-forget — never throws.
   * Audit failures must not impact the business operation.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO AUDIT_LOGS (ID, ACTOR_ID, ACTOR_EMAIL, ACTION, RESOURCE_TYPE, RESOURCE_ID, DETAILS, IP_ADDRESS, USER_AGENT, CORRELATION_ID, STATUS, CREATED_AT, RETENTION_DATE)
         VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, SYSDATE, SYSDATE + 90)`,
        [
          randomUUID(),
          entry.actorId,
          entry.actorEmail ?? null,
          entry.action,
          entry.resourceType,
          entry.resourceId ?? null,
          entry.details ?? null,
          entry.ipAddress ?? null,
          entry.userAgent ?? null,
          entry.correlationId ?? null,
          entry.status ?? 'success',
        ],
      );
    } catch (err) {
      // Audit failure must never block the business operation
      this.logger.error({
        message: 'Failed to write audit log entry',
        action: entry.action,
        resourceType: entry.resourceType,
        actorId: entry.actorId,
        err,
      });
    }
  }
}
