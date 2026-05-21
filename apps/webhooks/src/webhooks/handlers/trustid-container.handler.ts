import { Injectable, Logger } from '@nestjs/common';
import { TrustService, TrustRepository } from '@stripe-integration/domain';

// ---------------------------------------------------------------------------
// TrustID webhook payload types
// ---------------------------------------------------------------------------

export interface TrustIdWorkflowStorageItem {
  Key: string;
  Value: string | null;
}

export interface TrustIdWebhookCallback {
  CallbackId?: string;
  ProcessName?: string;
  State?: number;
  WorkflowName?: string;
  WorkflowState?: string;
  ErrorMessage?: string | null;
  WorkflowStorage?: TrustIdWorkflowStorageItem[];
}

export interface TrustIdWebhookResponse {
  ContainerId?: string;
  Success?: boolean;
  Message?: string;
}

export interface TrustIdWebhookPayload {
  Callback?: TrustIdWebhookCallback;
  Response?: TrustIdWebhookResponse;
}

// ---------------------------------------------------------------------------
// Shared helper — extract ContainerId from the real payload structure
// ---------------------------------------------------------------------------

export function extractContainerId(payload: TrustIdWebhookPayload): string | undefined {
  // Primary: WorkflowStorage array
  const storage = payload.Callback?.WorkflowStorage;
  if (storage) {
    const entry = storage.find((item) => item.Key === 'ContainerId');
    if (entry?.Value) return entry.Value;
  }

  // Fallback: Response.ContainerId
  if (payload.Response?.ContainerId) {
    return payload.Response.ContainerId;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles the TrustID "Container Submitted" webhook callback.
 *
 * TrustID Cloud sends this webhook when the guest has completed their
 * document upload/identity verification session and the container has been
 * submitted for processing.
 *
 * Identifying properties:
 *   Callback.WorkflowName  === "AutoReferral"
 *   Callback.WorkflowState === "Start"
 */
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
   * the token status as 'submitted'.
   */
  async handle(payload: TrustIdWebhookPayload): Promise<void> {
    const containerId = extractContainerId(payload);
    const callbackId = payload.Callback?.CallbackId;

    if (!containerId) {
      this.logger.warn({
        message: 'TrustID container-submitted webhook — could not extract ContainerId',
        callbackId: callbackId ?? 'unknown',
      });
      return;
    }

    this.logger.log({
      message: 'TrustID container submitted — guest completed upload',
      containerId,
      callbackId: callbackId ?? 'unknown',
    });

    const trustToken = await this.trustRepo.findByResourceId(containerId);

    if (!trustToken) {
      this.logger.warn({
        message: 'No trust token found for containerId — submission tracked but not linked',
        containerId,
      });
      return;
    }

    await this.trustRepo.updateStatus(trustToken.id, 'submitted');

    this.logger.log({
      message: 'Trust token updated to submitted — awaiting verification',
      tokenId: trustToken.id,
      containerId,
    });
  }
}
