import { Injectable, Logger } from '@nestjs/common';
import { TrustRepository } from '../../trust/trust.repository';
import { TrustIdService } from '../../trustid/trustid.service';;
import {
  TrustIdWebhookPayload,
  extractContainerId,
} from './trustid-container.handler';

/**
 * Handles the TrustID "Result Notification" webhook callback.
 *
 * TrustID Cloud sends this webhook when verification processing is complete
 * (Callback.WorkflowName === "AutoReferral", Callback.WorkflowState === "Stop").
 *
 * The heavy work (document retrieval + S3 upload) is handled by the
 * TrustIdWebhookProcessor. This handler validates the payload and looks
 * up the associated trust token.
 */
@Injectable()
export class TrustIdResultHandler {
  private readonly logger = new Logger(TrustIdResultHandler.name);

  constructor(
    private readonly trustIdService: TrustIdService,
    private readonly trustRepo: TrustRepository,
  ) {}

  /**
   * Validate and look up a TrustID result payload.
   *
   * Returns the containerId and associated trust token if the payload
   * is valid and a matching token exists. Returns null if the payload
   * is missing required fields, reports an error, or no token matches.
   */
  async handle(payload: TrustIdWebhookPayload): Promise<{
    containerId: string;
    tokenId: string;
    userId: string | null;
  } | null> {
    const containerId = extractContainerId(payload);
    const callbackId = payload.Callback?.CallbackId;

    if (!containerId) {
      this.logger.warn({
        message: 'TrustID result notification — could not extract ContainerId',
        callbackId: callbackId ?? 'unknown',
      });
      return null;
    }

    if (payload.Callback?.ErrorMessage) {
      this.logger.error({
        message: 'TrustID result notification reports error',
        containerId,
        errorMessage: payload.Callback.ErrorMessage,
      });
      return null;
    }

    this.logger.log({
      message: 'TrustID result notification received',
      containerId,
      callbackId: callbackId ?? 'unknown',
    });

    const trustToken = await this.trustRepo.findByResourceId(containerId);
    if (!trustToken) {
      this.logger.warn({
        message: 'No trust token found for containerId',
        containerId,
      });
      return null;
    }

    return {
      containerId,
      tokenId: trustToken.id,
      userId: trustToken.userId ?? null,
    };
  }

  /**
   * Infer a file extension from magic bytes.
   * Shared utility — also used by TrustIdWebhookProcessor.
   */
  inferExtension(data: Buffer): string {
    if (data.length < 4) return 'bin';
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'png';
    if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return 'pdf';
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return 'gif';
    if (
      (data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2a) ||
      (data[0] === 0x4d && data[1] === 0x4d && data[2] === 0x00)
    )
      return 'tiff';
    return 'bin';
  }
}
