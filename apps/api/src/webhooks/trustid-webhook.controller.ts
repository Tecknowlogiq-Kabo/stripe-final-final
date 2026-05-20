import {
  Controller,
  Post,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { TrustIdContainerHandler } from './handlers/trustid-container.handler';
import { TrustIdResultHandler } from './handlers/trustid-result.handler';

/**
 * Receives webhook callbacks from TrustID Cloud.
 *
 * TrustID sends two types of webhooks to this endpoint:
 *
 *   1. Container Submitted — guest completed document upload.
 *      Identified by: Callback.WorkflowState === "Start"
 *
 *   2. Result Notification — verification is complete.
 *      Identified by: Callback.WorkflowState === "Stop"
 *
 * This controller MUST:
 *   - Be @Public() (TrustID has no JWT)
 *   - Be @SkipThrottle() (critical delivery path)
 *   - Return 200 immediately (don't block — process async)
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
    private readonly resultHandler: TrustIdResultHandler,
  ) {}

  /**
   * Single endpoint for all TrustID webhook callbacks.
   * Routes to the appropriate handler based on Callback.WorkflowState.
   */
  @Public()
  @Post('trustid')
  @HttpCode(HttpStatus.OK)
  async handleTrustIdWebhook(@Req() req: Request) {
    const payload = req.body as Record<string, unknown>;

    const callback = (payload.Callback ?? {}) as Record<string, unknown>;
    const workflowState = callback.WorkflowState as string | undefined;

    this.logger.log({
      message: 'TrustID webhook received',
      workflowState: workflowState ?? 'unknown',
      callbackId: callback.CallbackId ?? 'unknown',
      processName: callback.ProcessName ?? 'unknown',
      containerId: ((payload.Container ?? {}) as Record<string, unknown>).Id ?? 'unknown',
    });

    // Route to handler based on WorkflowState
    // "Start" = Container Submitted (guest completed upload)
    // "Stop" = Result Notification (verification complete)
    switch (workflowState) {
      case 'Start':
        // Fire-and-forget — don't await, return 200 immediately
        this.containerHandler
          .handle(payload as any)
          .catch((err) =>
            this.logger.error({
              message: 'Container submitted handler failed',
              callbackId: callback.CallbackId,
              err,
            }),
          );
        break;

      case 'Stop':
        // Fire-and-forget — processing takes time (image retrieval + S3 upload)
        this.resultHandler
          .handle(payload as any)
          .catch((err) =>
            this.logger.error({
              message: 'Result notification handler failed',
              callbackId: callback.CallbackId,
              err,
            }),
          );
        break;

      default:
        this.logger.warn({
          message: 'Unknown TrustID webhook WorkflowState',
          workflowState: workflowState ?? 'missing',
          callbackId: callback.CallbackId,
        });
    }

    // Always return 200 immediately — TrustID needs fast acknowledgement
    return { received: true };
  }
}
