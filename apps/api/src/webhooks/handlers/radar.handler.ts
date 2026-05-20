import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class RadarHandler {
  private readonly logger = new Logger(RadarHandler.name);

  constructor(private readonly auditService: AuditService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const warning = event.data.object as Stripe.Radar.EarlyFraudWarning;
    const chargeId = typeof warning.charge === 'string' ? warning.charge : warning.charge.id;

    this.logger.warn({
      message: `Handling ${event.type}`,
      fraudWarningId: warning.id,
      stripeChargeId: chargeId,
      actionable: warning.actionable,
      fraudType: warning.fraud_type,
    });

    await this.auditService.log({
      actorId: 'system:radar',
      actorEmail: null,
      action: 'fraud_warning',
      resourceType: 'charge',
      resourceId: chargeId,
      details: JSON.stringify({
        fraudWarningId: warning.id,
        fraudType: warning.fraud_type,
        actionable: warning.actionable,
        chargeId,
      }),
      status: 'failure',
    });
  }
}
