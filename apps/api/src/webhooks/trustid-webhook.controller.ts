import {
  Controller,
  Post,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { TrustIdContainerHandler, extractContainerId, TrustIdWebhookPayload } from './handlers/trustid-container.handler';
import { TRUSTID_WEBHOOK_QUEUE } from './trustid-webhook-queue.constants';
import { TrustIdWebhookJobData } from './trustid-webhook.processor';

/**
 * Receives webhook callbacks from TrustID Cloud.
 *
 * TrustID sends THREE types of webhooks to this endpoint:
 *
 *   1. Container Submitted — guest completed document upload.
 *      Identified by: WorkflowName="AutoReferral" AND WorkflowState="Start"
 *      → Handled inline (lightweight status update, no file transfer).
 *
 *   2. Result Notification — verification is complete.
 *      Identified by: WorkflowName="AutoReferral" AND WorkflowState="Stop"
 *      → Enqueued to BullMQ for async document retrieval & S3 upload.
 *
 *   3. Container Modified Post Result — document updated after result.
 *      Identified by: WorkflowName="UpdateDocument" AND WorkflowState="Start"
 *      → Logged (no token state change — already processed).
 *
 * Route order matters: WorkflowName is checked FIRST, then WorkflowState.
 * This prevents "UpdateDocument" Start webhooks from being confused with
 * "AutoReferral" Start webhooks (which mean different things).
 *
 * This controller MUST:
 *   - Be @Public() (TrustID has no JWT)
 *   - Be @SkipThrottle() (critical delivery path)
 *   - Return 200 immediately (don't block — enqueue and return)
 *
 * The callback URL that TrustID Cloud hits is:
 *   POST /api/v1/webhooks/trustid
 *
 * This URL must be set in ContainerEventCallbackUrl when creating the guest link.
 */
@SkipThrottle()
@Controller('webhooks')
export class TrustIdWebhookController {
  private readonly logger = new Logger(TrustIdWebhookController.name);

  constructor(
    private readonly containerHandler: TrustIdContainerHandler,
    @InjectQueue(TRUSTID_WEBHOOK_QUEUE) private readonly trustIdQueue: Queue<TrustIdWebhookJobData>,
  ) {}

  /**
   * Single endpoint for all TrustID webhook callbacks.
   * Routes to the appropriate handler based on Callback.WorkflowName
   * AND Callback.WorkflowState (both required for correct routing).
   *
   * Why WorkflowName matters: TrustID sends both "AutoReferral" and
   * "UpdateDocument" workflows. Both can have WorkflowState="Start" but
   * mean completely different things:
   *   - AutoReferral + Start = guest completed upload (→ submitted)
   *   - UpdateDocument + Start = document modified post-result (→ log only)
   */
  @Public()
  @Post('trustid')
  @HttpCode(HttpStatus.OK)
  async handleTrustIdWebhook(@Req() req: Request) {
    const payload = req.body as TrustIdWebhookPayload;

    const callback = payload.Callback ?? {};
    const workflowName = callback.WorkflowName;
    const workflowState = callback.WorkflowState;
    const containerId = extractContainerId(payload);
    const callbackId = callback.CallbackId;

    // Extract DocumentId for post-result update webhooks
    const documentId = callback.WorkflowStorage?.find(
      (item) => item.Key === 'DocumentId',
    )?.Value ?? undefined;

    this.logger.log({
      message: 'TrustID webhook received',
      workflowName: workflowName ?? 'unknown',
      workflowState: workflowState ?? 'unknown',
      callbackId: callbackId ?? 'unknown',
      processName: callback.ProcessName ?? 'unknown',
      containerId: containerId ?? 'unknown',
      documentId: documentId ?? 'none',
    });

    // ---- Route by WorkflowName first, then WorkflowState ----

    if (workflowName === 'AutoReferral') {
      return this.handleAutoReferral(payload, containerId, callbackId);
    }

    if (workflowName === 'UpdateDocument') {
      return this.handleUpdateDocument(payload, containerId, callbackId, documentId);
    }

    // Unknown WorkflowName
    this.logger.warn({
      message: 'Unknown TrustID webhook WorkflowName',
      workflowName: workflowName ?? 'missing',
      workflowState: workflowState ?? 'missing',
      callbackId,
    });

    return { received: true };
  }

  // -----------------------------------------------------------------------
  // AutoReferral workflow
  // -----------------------------------------------------------------------

  /**
   * Handle AutoReferral workflow webhooks.
   *   - Start: guest completed upload → mark token as 'submitted'
   *   - Stop:  verification complete → enqueue BullMQ for S3 pull
   */
  private async handleAutoReferral(
    payload: TrustIdWebhookPayload,
    containerId: string | undefined,
    callbackId: string | undefined,
  ) {
    const workflowState = payload.Callback?.WorkflowState;

    switch (workflowState) {
      case 'Start':
        // Lightweight fire-and-forget — just updates token status to 'submitted'
        this.containerHandler
          .handle(payload)
          .catch((err) =>
            this.logger.error({
              message: 'Container submitted handler failed',
              callbackId,
              err,
            }),
          );
        break;

      case 'Stop':
        if (!containerId) {
          this.logger.warn({
            message: 'TrustID "Stop" webhook missing containerId — cannot enqueue',
            callbackId: callbackId ?? 'unknown',
          });
        } else {
          // Enqueue for async BullMQ processing — retry, DLQ, observability
          this.trustIdQueue
            .add(TRUSTID_WEBHOOK_QUEUE, { containerId, callbackId })
            .then((job) =>
              this.logger.log({
                message: 'TrustID verification job enqueued',
                jobId: job.id,
                containerId,
                callbackId: callbackId ?? 'unknown',
              }),
            )
            .catch((err) =>
              this.logger.error({
                message: 'Failed to enqueue TrustID verification job',
                containerId,
                callbackId,
                err,
              }),
            );
        }
        break;

      default:
        this.logger.warn({
          message: 'Unknown AutoReferral WorkflowState',
          workflowState: workflowState ?? 'missing',
          callbackId,
        });
    }

    return { received: true };
  }

  // -----------------------------------------------------------------------
  // UpdateDocument workflow (post-result update)
  // -----------------------------------------------------------------------

  /**
   * Handle UpdateDocument workflow webhooks.
   *
   * This fires when a container document is modified AFTER the result has
   * already been published. We log it but take NO action — the token has
   * already been processed and the S3 files already stored. Re-processing
   * would overwrite verified files with modified ones.
   *
   * The DocumentId in WorkflowStorage identifies which document changed.
   */
  private async handleUpdateDocument(
    _payload: TrustIdWebhookPayload,
    containerId: string | undefined,
    callbackId: string | undefined,
    documentId: string | undefined,
  ) {
    this.logger.log({
      message:
        'TrustID UpdateDocument webhook — post-result document update (no action taken)',
      containerId: containerId ?? 'unknown',
      callbackId: callbackId ?? 'unknown',
      documentId: documentId ?? 'unknown',
    });

    return { received: true };
  }
}
