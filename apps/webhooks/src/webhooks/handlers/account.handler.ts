import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { AuditService } from '@stripe-integration/domain';

@Injectable()
export class AccountHandler {
  private readonly logger = new Logger(AccountHandler.name);

  constructor(private readonly auditService: AuditService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const account = event.data.object as Stripe.Account;
    const previous = event.data.previous_attributes as Record<string, unknown> | undefined;

    this.logger.log({
      message: `Handling ${event.type}`,
      stripeAccountId: account.id,
      changedFields: previous ? Object.keys(previous) : [],
    });

    await this.auditService.log({
      actorId: 'system:webhook',
      actorEmail: null,
      action: 'account_updated',
      resourceType: 'account',
      resourceId: account.id,
      details: JSON.stringify({
        previousAttributes: previous,
        currentFields: {
          payouts_enabled: account.payouts_enabled,
          charges_enabled: account.charges_enabled,
          requirements_disabled_reason: account.requirements?.disabled_reason,
          capabilities: account.capabilities
            ? Object.entries(account.capabilities)
                .filter(([, v]) => v === 'active')
                .map(([k]) => k)
            : [],
        },
      }),
    });
  }
}
