import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { AuditService } from '../../audit/audit.service';;

@Injectable()
export class ChargeHandler {
  private readonly logger = new Logger(ChargeHandler.name);

  constructor(private readonly auditService: AuditService) {}

  async handle(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'charge.succeeded': {
        const charge = event.data.object as Stripe.Charge;
        this.logger.log({
          message: 'Charge succeeded',
          stripeChargeId: charge.id,
          stripePaymentIntentId: charge.payment_intent,
          amount: charge.amount,
          currency: charge.currency,
          paymentMethod: charge.payment_method,
        });
        break;
      }

      case 'charge.failed': {
        const charge = event.data.object as Stripe.Charge;
        this.logger.warn({
          message: 'Charge failed',
          stripeChargeId: charge.id,
          stripePaymentIntentId: charge.payment_intent,
          amount: charge.amount,
          currency: charge.currency,
          failureReason: charge.failure_code,
          failureMessage: charge.failure_message,
          outcome: charge.outcome
            ? { networkStatus: charge.outcome.network_status, reason: charge.outcome.reason }
            : undefined,
        });
        await this.auditService.log({
          actorId: 'system:webhook',
          actorEmail: null,
          action: 'charge.failed',
          resourceType: 'charge',
          resourceId: charge.id,
          details: JSON.stringify({
            failureCode: charge.failure_code,
            failureMessage: charge.failure_message,
            amount: charge.amount,
            currency: charge.currency,
            outcome: charge.outcome,
          }),
          status: 'failure',
        });
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        this.logger.log({
          message: 'Charge refunded',
          stripeChargeId: charge.id,
          stripePaymentIntentId: charge.payment_intent,
          amount: charge.amount,
          amountRefunded: charge.amount_refunded,
          currency: charge.currency,
        });
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        this.logger.warn({
          message: 'Dispute created on charge',
          disputeId: dispute.id,
          stripeChargeId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
          reason: dispute.reason,
          status: dispute.status,
          amount: dispute.amount,
          currency: dispute.currency,
        });
        await this.auditService.log({
          actorId: 'system:webhook',
          actorEmail: null,
          action: 'dispute.created',
          resourceType: 'charge',
          resourceId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
          details: JSON.stringify({
            disputeId: dispute.id,
            reason: dispute.reason,
            status: dispute.status,
            amount: dispute.amount,
            currency: dispute.currency,
            evidenceDueBy: dispute.evidence_details?.due_by,
          }),
          status: 'failure',
        });
        break;
      }

      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute;
        this.logger.log({
          message: 'Dispute closed',
          disputeId: dispute.id,
          stripeChargeId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
          status: dispute.status,
          reason: dispute.reason,
        });
        await this.auditService.log({
          actorId: 'system:webhook',
          actorEmail: null,
          action: 'dispute.closed',
          resourceType: 'charge',
          resourceId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
          details: JSON.stringify({
            disputeId: dispute.id,
            status: dispute.status,
            reason: dispute.reason,
          }),
          status: dispute.status === 'won' ? 'success' : 'failure',
        });
        break;
      }

      case 'charge.dispute.updated': {
        const dispute = event.data.object as Stripe.Dispute;
        const previous = event.data.previous_attributes as Record<string, unknown> | undefined;
        this.logger.log({
          message: 'Dispute updated',
          disputeId: dispute.id,
          stripeChargeId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
          status: dispute.status,
          changedFields: previous ? Object.keys(previous) : [],
        });
        await this.auditService.log({
          actorId: 'system:webhook',
          actorEmail: null,
          action: 'dispute.updated',
          resourceType: 'charge',
          resourceId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
          details: JSON.stringify({
            disputeId: dispute.id,
            status: dispute.status,
            changedFields: previous ? Object.keys(previous) : [],
            previousAttributes: previous,
          }),
        });
        break;
      }

      default:
        this.logger.warn({
          message: `Unhandled charge event sub-type: ${event.type}`,
          eventId: event.id,
        });
    }
  }
}
