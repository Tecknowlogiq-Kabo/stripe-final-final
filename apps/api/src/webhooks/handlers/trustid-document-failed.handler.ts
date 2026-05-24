import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrustIdService } from '../../trustid/trustid.service';
import { TrustRepository } from '../../trust/trust.repository';
import { EmailService } from '../../email/email.service';

@Injectable()
export class TrustIdDocumentFailedHandler {
  private readonly logger = new Logger(TrustIdDocumentFailedHandler.name);
  private readonly retryBranchId: string | null;
  private readonly maxRetries: number;

  constructor(
    private readonly trustIdService: TrustIdService,
    private readonly trustRepo: TrustRepository,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {
    this.retryBranchId = this.configService.get<string>('trustid.retryBranchId') ?? null;
    this.maxRetries = this.configService.get<number>('trustid.maxDocRetries') ?? 2;
  }

  /**
   * Handle UpdateDocument + Stop webhook.
   * Retrieves the container to check OverallStatus.
   * If ALERT (failed), creates a new guest link on the retry branch.
   */
  async handle(containerId: string, callbackId?: string): Promise<void> {
    this.logger.log({ message: 'Processing UpdateDocument+Stop', containerId, callbackId });

    // Retrieve container to inspect OverallStatus
    let container: Record<string, unknown>;
    try {
      container = await this.trustIdService.retrieveDocumentContainer(containerId);
    } catch (err) {
      this.logger.error({ message: 'Failed to retrieve container for failed-document check', containerId, err });
      return;
    }

    const overallStatus = container.OverallStatus as string | undefined;
    this.logger.log({ message: 'Container status retrieved', containerId, overallStatus });

    if (overallStatus !== 'ALERT') {
      // NO_ALERT = pass, RESOLVED = alert reviewed — nothing to do
      return;
    }

    // Container failed — look up the trust token
    const trustToken = await this.trustRepo.findByResourceId(containerId);
    if (!trustToken) {
      this.logger.warn({ message: 'No trust token found for failed container', containerId });
      return;
    }

    // Guard against retry loops — read retryCount from metadata as fallback (Task 4 will add DB column)
    const currentRetryCount = (trustToken as any).retryCount ?? (() => {
      try { return JSON.parse(trustToken.metadata ?? '{}').retryCount ?? 0; } catch { return 0; }
    })();

    if (currentRetryCount >= this.maxRetries) {
      this.logger.warn({
        message: 'Max document retries reached — not creating new guest link',
        containerId,
        retryCount: currentRetryCount,
        maxRetries: this.maxRetries,
      });
      return;
    }

    if (!this.retryBranchId) {
      this.logger.warn({ message: 'TRUSTID_RETRY_BRANCH_ID not configured — cannot create retry guest link', containerId });
      return;
    }

    // Extract email/name from token metadata
    let guestEmail = 'guest@example.com';
    let guestName = 'Guest';
    try {
      const meta = JSON.parse(trustToken.metadata ?? '{}');
      guestEmail = meta.trustidGuestEmail ?? guestEmail;
      guestName = meta.trustidGuestName ?? guestName;
    } catch { /* use defaults */ }

    // Create new guest link on retry branch
    let newGuestLink: string;
    let newContainerId: string;
    try {
      const result = await this.trustIdService.createGuestLink({
        email: guestEmail,
        name: guestName,
        branchId: this.retryBranchId,
        sendEmail: true,
      });
      newGuestLink = result.guestLinkUrl;
      newContainerId = result.containerId;
    } catch (err) {
      this.logger.error({ message: 'Failed to create retry guest link', containerId, err });
      return;
    }

    // Update token metadata with retry info
    try {
      const meta = JSON.parse(trustToken.metadata ?? '{}');
      meta.retryGuestLink = newGuestLink;
      meta.retryContainerId = newContainerId;
      meta.retryBranchId = this.retryBranchId;
      meta.lastFailedContainerId = containerId;
      await this.trustRepo.updateMetadata(trustToken.id, JSON.stringify(meta));
      await this.trustRepo.incrementRetryCount(trustToken.id, this.retryBranchId);
    } catch (err) {
      this.logger.error({ message: 'Failed to update token metadata after retry', containerId, err });
    }

    this.logger.log({
      message: 'Document failed — retry guest link created',
      originalContainerId: containerId,
      newContainerId,
      retryBranchId: this.retryBranchId,
      tokenId: trustToken.id,
    });
  }
}
