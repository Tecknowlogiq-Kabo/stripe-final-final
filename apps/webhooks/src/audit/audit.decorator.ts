import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditMetadata {
  action: string;
  resourceType: string;
  /** Dot-notation path to the resource ID in the response or params (e.g., 'id' or 'customerId') */
  resourceIdPath?: string;
  /** Extra details to include */
  details?: string;
}

/**
 * Marks a controller method for automatic audit logging.
 * The AuditInterceptor reads this metadata after the handler completes
 * and records an audit entry.
 *
 * Usage:
 *   @Audit({ action: 'payment.create', resourceType: 'payment-intent', resourceIdPath: 'id' })
 */
export const Audit = (metadata: AuditMetadata) =>
  SetMetadata(AUDIT_KEY, metadata);
