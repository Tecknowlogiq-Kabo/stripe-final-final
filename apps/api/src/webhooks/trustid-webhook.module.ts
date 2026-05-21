import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TrustModule } from '../trust/trust.module';
import { S3Module } from '../s3/s3.module';
import { TrustIdModule } from '../trustid/trustid.module';
import { TrustIdWebhookController } from './trustid-webhook.controller';
import { TrustIdContainerHandler } from './handlers/trustid-container.handler';
import { TrustIdResultHandler } from './handlers/trustid-result.handler';
import { TrustIdWebhookProcessor } from './trustid-webhook.processor';
import { TRUSTID_WEBHOOK_QUEUE, TRUSTID_WEBHOOK_DLQ } from './trustid-webhook-queue.constants';

/**
 * TrustID webhook module.
 *
 * Receives webhook callbacks from TrustID Cloud when containers are
 * submitted and when verification is complete. "Start" webhooks are
 * handled inline (lightweight status update). "Stop" webhooks are
 * enqueued to BullMQ for async document retrieval and S3 upload.
 *
 * BullMQ provides retry, dead-letter queuing, and observability for
 * the document pull pipeline.
 *
 * Dependencies:
 *   - TrustModule (trust token lookup + status updates)
 *   - TrustIdModule (TrustID API client — retrieveDocumentContainer, retrieveImage, exportPdf)
 *   - S3Module (upload documents/reports to S3)
 */
@Module({
  imports: [
    TrustModule,
    TrustIdModule,
    S3Module,
    ConfigModule,
    BullModule.registerQueue({
      name: TRUSTID_WEBHOOK_QUEUE,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    }),
    BullModule.registerQueue({
      name: TRUSTID_WEBHOOK_DLQ,
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    }),
  ],
  controllers: [TrustIdWebhookController],
  providers: [TrustIdContainerHandler, TrustIdResultHandler, TrustIdWebhookProcessor],
  exports: [TrustIdContainerHandler, TrustIdResultHandler, TrustIdWebhookProcessor],
})
export class TrustIdWebhookModule {}
