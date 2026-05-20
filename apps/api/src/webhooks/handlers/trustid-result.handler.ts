import { Injectable, Logger } from '@nestjs/common';
import { TrustService } from '../../trust/trust.service';
import { TrustRepository } from '../../trust/trust.repository';
import { S3Service } from '../../s3/s3.service';
import { TrustIdService } from '../../trustid/trustid.service';

/**
 * Handles the TrustID "Result Notification" webhook callback.
 *
 * TrustID Cloud sends this webhook when verification processing is complete
 * (Callback.WorkflowName === "AutoReferral", Callback.WorkflowState === "Stop").
 *
 * This handler retrieves all verified documents and the PDF report from
 * TrustID Cloud, stores them in S3, and approves the associated trust token.
 */

export interface TrustIdResultPayload {
  Callback?: {
    CallbackId?: string;
    ProcessName?: string;
    State?: number;
    WorkflowName?: string;
    ErrorMessage?: string;
  };
  Container?: {
    Id?: string;
    ApplicationContainerCode?: string;
    ApplicationId?: string;
  };
}

@Injectable()
export class TrustIdResultHandler {
  private readonly logger = new Logger(TrustIdResultHandler.name);

  constructor(
    private readonly trustIdService: TrustIdService,
    private readonly trustService: TrustService,
    private readonly trustRepo: TrustRepository,
    private readonly s3Service: S3Service,
  ) {}

  async handle(payload: TrustIdResultPayload): Promise<void> {
    const containerId = payload.Container?.Id;
    const callbackId = payload.Callback?.CallbackId;

    if (!containerId) {
      this.logger.warn({
        message: 'TrustID result notification missing Container.Id',
        callbackId: callbackId ?? 'unknown',
      });
      return;
    }

    // Check for processing errors reported by TrustID
    if (payload.Callback?.ErrorMessage) {
      this.logger.error({
        message: 'TrustID result notification reports error',
        containerId,
        errorMessage: payload.Callback.ErrorMessage,
      });
      return;
    }

    this.logger.log({
      message: 'TrustID verification complete — retrieving documents',
      containerId,
      callbackId: callbackId ?? 'unknown',
    });

    // Look up the trust token associated with this container
    const trustToken = await this.trustRepo.findByResourceId(containerId);
    if (!trustToken) {
      this.logger.warn({
        message: 'No trust token found for containerId',
        containerId,
      });
      return;
    }

    const s3Prefix = `trust-approved/${containerId}`;
    let totalBytes = 0;

    try {
      // 1. Retrieve the full application container from TrustID
      this.logger.log({ message: 'Retrieving document container from TrustID', containerId });
      const container = await this.trustIdService.retrieveDocumentContainer(containerId);

      const c = container as Record<string, unknown>;
      const docs = (c.Documents ?? []) as Record<string, unknown>[];

      if (docs.length === 0) {
        this.logger.warn({ message: 'Container has no documents', containerId });
      } else {
        // 2. Retrieve every document image and store in S3
        for (const doc of docs) {
          const images = (doc.Images ?? []) as Record<string, unknown>[];
          for (const image of images) {
            const imageId = image.Id as string | undefined;
            if (!imageId) continue;
            try {
              this.logger.log({ message: 'Retrieving image from TrustID', containerId, imageId });

              const imageData = await this.trustIdService.retrieveImage(imageId);
              const ext = this.inferExtension(imageData);
              const s3Key = `${s3Prefix}/documents/${imageId}.${ext}`;

              await this.s3Service.upload(s3Key, imageData, `image/${ext === 'jpg' ? 'jpeg' : ext}`);
              totalBytes += imageData.length;

              this.logger.log({
                message: 'Document image stored in S3',
                containerId,
                imageId,
                s3Key,
                size: imageData.length,
              });
            } catch (err) {
              this.logger.error({
                message: 'Failed to retrieve or store document image',
                containerId,
                imageId,
                err,
              });
            }
          }
        }
      }

      // 3. Generate PDF report and store in S3
      try {
        this.logger.log({ message: 'Generating PDF report', containerId });
        const pdfData = await this.trustIdService.exportPDF(containerId);
        const pdfKey = `${s3Prefix}/report.pdf`;

        await this.s3Service.upload(pdfKey, pdfData, 'application/pdf');
        totalBytes += pdfData.length;

        this.logger.log({
          message: 'PDF report stored in S3',
          containerId,
          s3Key: pdfKey,
          size: pdfData.length,
        });
      } catch (err) {
        this.logger.error({ message: 'Failed to generate or store PDF report', containerId, err });
        // Non-fatal — continue with approval even if PDF fails
      }

      // 4. Approve the trust token
      await this.trustRepo.updateStatus(trustToken.id, 'approved');

      this.logger.log({
        message: 'TrustID result handler complete — documents stored in S3',
        containerId,
        tokenId: trustToken.id,
        totalBytes,
      });
    } catch (err) {
      this.logger.error({
        message: 'Failed to process TrustID results',
        containerId,
        tokenId: trustToken.id,
        err,
      });
    }
  }

  /**
   * Infer a file extension from magic bytes.
   */
  private inferExtension(data: Buffer): string {
    if (data.length < 4) return 'bin';
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'png';
    if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return 'pdf';
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return 'gif';
    if ((data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2a) ||
        (data[0] === 0x4d && data[1] === 0x4d && data[2] === 0x00)) return 'tiff';
    return 'bin';
  }
}
