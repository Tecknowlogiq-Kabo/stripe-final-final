import {
  Controller,
  Post,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Request } from 'express';
import { TrustIdContainerHandler, extractContainerId, TrustIdWebhookPayload } from './handlers/trustid-container.handler';
import { TRUSTID_WEBHOOK_QUEUE } from './trustid-webhook-queue.constants';
import { TrustIdWebhookJobData } from './trustid-webhook.processor';
import { TrustIdWebhookGuard } from '../common/guards/trustid-webhook.guard';

/**
 * Receives webhook callbacks from TrustID Cloud.
 *
 * Routes by Callback.WorkflowName first, then Callback.WorkflowState:
 *
 *   AutoReferral + Start → inline status update to 'submitted'
 *   AutoReferral + Stop  → enqueued to BullMQ for async S3 pull
 *   UpdateDocument + *    → logged only (no action)
 *
 * Protected by TrustIdWebhookGuard — requires x-trustid-secret header
 * matching TRUSTID_WEBHOOK_SECRET (when configured).
 */
@Controller('webhooks')
export class TrustIdWebhookController {
  private readonly logger = new Logger(TrustIdWebhookController.name);

  constructor(
    private readonly containerHandler: TrustIdContainerHandler,
    @InjectQueue(TRUSTID_WEBHOOK_QUEUE) private readonly trustIdQueue: Queue<TrustIdWebhookJobData>,
  ) {}

  @Post('trustid')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TrustIdWebhookGuard)
  async handleTrustIdWebhook(@Req() req: Request) {
    const payload = req.body as TrustIdWebhookPayload;

    const callback = payload.Callback ?? {};
    const workflowName = callback.WorkflowName;
    const workflowState = callback.WorkflowState;
    const containerId = extractContainerId(payload);
    const callbackId = callback.CallbackId;

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

    if (workflowName === 'AutoReferral') {
      return this.handleAutoReferral(payload, containerId, callbackId);
    }

    if (workflowName === 'UpdateDocument') {
      return this.handleUpdateDocument(containerId, callbackId, documentId);
    }

    this.logger.warn({
      message: 'Unknown TrustID webhook WorkflowName',
      workflowName: workflowName ?? 'missing',
      workflowState: workflowState ?? 'missing',
      callbackId,
    });

    return { received: true };
  }

  private async handleAutoReferral(
    payload: TrustIdWebhookPayload,
    containerId: string | undefined,
    callbackId: string | undefined,
  ) {
    const workflowState = payload.Callback?.WorkflowState;

    switch (workflowState) {
      case 'Start':
        try {
          await this.containerHandler.handle(payload);
        } catch (err) {
          this.logger.error({
            message: 'Container submitted handler failed',
            callbackId,
            err,
          });
          throw err;
        }
        break;

      case 'Stop':
        if (!containerId) {
          this.logger.warn({
            message: 'TrustID "Stop" webhook missing containerId — cannot enqueue',
            callbackId: callbackId ?? 'unknown',
          });
        } else {
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

  private async handleUpdateDocument(
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
