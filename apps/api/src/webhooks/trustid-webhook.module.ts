import { Module } from '@nestjs/common';
import { TrustModule } from '../trust/trust.module';
import { S3Module } from '../s3/s3.module';
import { TrustIdModule } from '../trustid/trustid.module';
import { TrustIdWebhookController } from './trustid-webhook.controller';
import { TrustIdContainerHandler } from './handlers/trustid-container.handler';
import { TrustIdResultHandler } from './handlers/trustid-result.handler';

/**
 * TrustID webhook module.
 *
 * Receives webhook callbacks from TrustID Cloud when containers are
 * submitted and when verification is complete. Handlers retrieve
 * documents from TrustID and store them in S3.
 *
 * Dependencies:
 *   - TrustModule (trust token lookup + status updates)
 *   - TrustIdModule (TrustID API client — retrieveDocumentContainer, retrieveImage, exportPdf)
 *   - S3Module (upload documents/reports to S3)
 */
@Module({
  imports: [TrustModule, TrustIdModule, S3Module],
  controllers: [TrustIdWebhookController],
  providers: [TrustIdContainerHandler, TrustIdResultHandler],
  exports: [TrustIdContainerHandler, TrustIdResultHandler],
})
export class TrustIdWebhookModule {}
