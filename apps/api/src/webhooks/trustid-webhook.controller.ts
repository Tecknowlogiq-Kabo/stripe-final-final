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
 * TrustID sends two types of webhooks to this endpoint:
 *
 *   1. Container Submitted — guest completed document upload.
 *      Identified by: Callback.WorkflowState === "Start"
 *      → Handled inline (lightweight status update, no file transfer).
 *
 *   2. Result Notification — verification is complete.
 *      Identified by: Callback.WorkflowState === "Stop"
 *      → Enqueued to BullMQ for async document retrieval & S3 upload.
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
   * Routes to the appropriate handler based on Callback.WorkflowState.
   */
  @Public()
  @Post('trustid')
  @HttpCode(HttpStatus.OK)
  async handleTrustIdWebhook(@Req() req: Request) {
    const payload = req.body as TrustIdWebhookPayload;

    const callback = payload.Callback ?? {};
    const workflowState = callback.WorkflowState;
    const containerId = extractContainerId(payload);
    const callbackId = callback.CallbackId;

    this.logger.log({
      message: 'TrustID webhook received',
      workflowState: workflowState ?? 'unknown',
      callbackId: callbackId ?? 'unknown',
      processName: callback.ProcessName ?? 'unknown',
      containerId: containerId ?? 'unknown',
    });

    // Route to handler based on WorkflowState
    // "Start" = Container Submitted (guest completed upload)
    // "Stop" = Result Notification (verification complete)
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
            message: 'TrustID "Stop" webhook missing Container.Id — cannot enqueue',
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
          message: 'Unknown TrustID webhook WorkflowState',
          workflowState: workflowState ?? 'missing',
          callbackId: callbackId,
        });
    }

    // Always return 200 immediately — TrustID needs fast acknowledgement
    return { received: true };
  }
}
