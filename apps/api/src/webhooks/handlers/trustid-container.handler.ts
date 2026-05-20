import { Injectable, Logger } from '@nestjs/common';
import { TrustService } from '../../trust/trust.service';
import { TrustRepository } from '../../trust/trust.repository';

/**
 * Handles the TrustID "Container Submitted" webhook callback.
 *
 * TrustID Cloud sends this webhook when the guest has completed their
 * document upload/identity verification session and the container has been
 * submitted for processing. This gives us the ContainerId — the key used
 * to retrieve results later.
 *
 * Identifying properties:
 *   Callback.WorkflowName  === "AutoReferral"
 *   Callback.WorkflowState === "Start"
 */
export interface TrustIdCallbackPayload {
  Callback?: {
    CallbackId?: string;
    ProcessName?: string;
    State?: number;
    WorkflowName?: string;
  };
  Container?: {
    Id?: string;
    ApplicationContainerCode?: string;
  };
}

@Injectable()
export class TrustIdContainerHandler {
  private readonly logger = new Logger(TrustIdContainerHandler.name);

  constructor(
    private readonly trustService: TrustService,
    private readonly trustRepo: TrustRepository,
  ) {}

  /**
   * Handle a Container Submitted webhook from TrustID.
   * Extracts the ContainerId, maps it to a trust token, and marks
   * the token status as 'submitted' — awaiting verification.
   */
  async handle(payload: TrustIdCallbackPayload): Promise<void> {
    const containerId = payload.Container?.Id;
    const callbackId = payload.Callback?.CallbackId;

    if (!containerId) {
      this.logger.warn({
        message: 'TrustID container submitted webhook missing Container.Id',
        callbackId: callbackId ?? 'unknown',
      });
      return;
    }

    this.logger.log({
      message: 'TrustID container submitted — guest completed upload',
      containerId,
      callbackId: callbackId ?? 'unknown',
      applicationCode: payload.Container?.ApplicationContainerCode,
    });

    // Look up the trust token by resourceId (set to containerId when
    // the TrustID guest link was created). For TrustID resource type,
    // the token's resourceId is the ContainerId.
    const trustToken = await this.trustRepo.findByResourceId(containerId);

    if (!trustToken) {
      // If the containerId was stored in the token's metadata instead,
      // we can still proceed by recording the submission.
      this.logger.warn({
        message: 'No trust token found for containerId — submission tracked but not linked',
        containerId,
      });
      return;
    }

    // Update trust token status to 'submitted' to reflect the guest
    // has completed their submission and verification is in progress.
    await this.trustRepo.updateStatus(trustToken.id, 'submitted');

    this.logger.log({
      message: 'Trust token updated to submitted — awaiting verification',
      tokenId: trustToken.id,
      containerId,
      status: trustToken.status,
    });
  }
}
