import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { TRUSTID_WEBHOOK_QUEUE, TRUSTID_WEBHOOK_DLQ } from './trustid-webhook-queue.constants';
import { TrustIdService } from '../trustid/trustid.service';
import { TrustRepository } from '../trust/trust.repository';
import { S3Service } from '../s3/s3.service';

// ---------------------------------------------------------------------------
// Job Data
// ---------------------------------------------------------------------------

export interface TrustIdWebhookJobData {
  containerId: string;
  callbackId?: string;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

/**
 * BullMQ worker that processes TrustID webhook callbacks asynchronously.
 *
 * When TrustID Cloud sends a "Stop" webhook (verification complete), this
 * processor retrieves all verified documents from TrustID Cloud and stores
 * them in our S3 bucket under a user-scoped prefix:
 *
 *   users/{userId}/trust-approved/{containerId}/documents/{imageId}.{ext}
 *   users/{userId}/trust-approved/{containerId}/report.pdf
 *
 * After successful S3 upload, the associated trust token is marked 'approved'.
 *
 * Each job is wrapped in an OTel span for visibility in Tempo.
 */
@Processor(TRUSTID_WEBHOOK_QUEUE)
export class TrustIdWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(TrustIdWebhookProcessor.name);

  constructor(
    private readonly trustIdService: TrustIdService,
    private readonly trustRepo: TrustRepository,
    private readonly s3Service: S3Service,
    @InjectQueue(TRUSTID_WEBHOOK_DLQ) private readonly dlq: Queue<TrustIdWebhookJobData>,
  ) {
    super();
  }

  // -----------------------------------------------------------------------
  // Main job handler
  // -----------------------------------------------------------------------

  async process(job: Job<TrustIdWebhookJobData>): Promise<void> {
    const { containerId, callbackId } = job.data;
    const tracer = trace.getTracer('trustid-webhooks');
    const span = tracer.startSpan('trustid-webhook.process', {
      attributes: {
        'trustid.container_id': containerId,
        'trustid.job_id': job.id ?? 'unknown',
        'trustid.attempt': job.attemptsMade + 1,
        'messaging.system': 'bullmq',
        'messaging.destination': TRUSTID_WEBHOOK_QUEUE,
      },
    });

    this.logger.log({
      message: 'Processing TrustID webhook job',
      jobId: job.id,
      containerId,
      callbackId: callbackId ?? 'unknown',
      attempt: job.attemptsMade + 1,
      traceId: span.spanContext().traceId,
    });

    try {
      await this.pullAndStore(containerId);
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  }

  // -----------------------------------------------------------------------
  // Core logic: pull documents from TrustID → upload to S3 → approve token
  // -----------------------------------------------------------------------

  private async pullAndStore(containerId: string): Promise<void> {
    // ---- 1. Look up the trust token associated with this container ----
    const trustToken = await this.trustRepo.findByResourceId(containerId);
    if (!trustToken) {
      this.logger.warn({
        message: 'No trust token found for containerId — skipping S3 pull',
        containerId,
      });
      return;
    }

    const s3Prefix = trustToken.userId
      ? `users/${trustToken.userId}/trust-approved/${containerId}`
      : `trust-approved/${containerId}`;
    let totalBytes = 0;

    // ---- 2. Retrieve the full document container from TrustID ----
    this.logger.log({ message: 'Retrieving document container from TrustID', containerId });
    const container = await this.trustIdService.retrieveDocumentContainer(containerId);

    const c = container as Record<string, unknown>;
    const docs = (c.Documents ?? []) as Record<string, unknown>[];

    // ---- 3. Pull every document image and store in S3 ----
    if (docs.length === 0) {
      this.logger.warn({ message: 'Container has no documents', containerId });
    } else {
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
            // Continue with remaining images — don't fail the whole job
          }
        }
      }
    }

    // ---- 4. Generate PDF report and store in S3 ----
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

    // ---- 5. Approve the trust token ----
    await this.trustRepo.updateStatus(trustToken.id, 'approved');

    this.logger.log({
      message: 'TrustID webhook job complete — documents stored in S3',
      containerId,
      tokenId: trustToken.id,
      totalBytes,
    });
  }

  // -----------------------------------------------------------------------
  // Magic-byte extension detection
  // -----------------------------------------------------------------------

  private inferExtension(data: Buffer): string {
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

  // -----------------------------------------------------------------------
  // DLQ handling
  // -----------------------------------------------------------------------

  @OnWorkerEvent('failed')
  async onFailed(job: Job<TrustIdWebhookJobData>, error: Error): Promise<void> {
    const attemptsMade = (job.attemptsMade ?? 0) + 1;
    const maxAttempts = (job.opts?.attempts as number) ?? 5;

    if (attemptsMade >= maxAttempts) {
      this.logger.error({
        message: 'TrustID webhook job exhausted all retries — moving to DLQ',
        jobId: job.id,
        containerId: job.data.containerId,
        callbackId: job.data.callbackId ?? 'unknown',
        attempts: attemptsMade,
        error: error.message,
      });

      await this.dlq.add(`${job.data.containerId}-dlq`, job.data, {
        removeOnComplete: false,
        removeOnFail: false,
      });
    }
  }
}
