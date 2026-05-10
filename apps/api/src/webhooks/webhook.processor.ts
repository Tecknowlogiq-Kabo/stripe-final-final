import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WEBHOOK_QUEUE } from './webhook-queue.constants';
import { WebhooksService } from './webhooks.service';

interface WebhookJobData {
  eventId: string;
  recordId: string;
}

@Processor(WEBHOOK_QUEUE)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly webhooksService: WebhooksService) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { eventId, recordId } = job.data;

    this.logger.log({
      message: 'Processing webhook job',
      jobId: job.id,
      eventId,
      recordId,
      attempt: job.attemptsMade + 1,
    });

    await this.webhooksService.execute(eventId, recordId);
  }
}
