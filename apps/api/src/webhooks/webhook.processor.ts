import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { WEBHOOK_QUEUE, WEBHOOK_DLQ } from './webhook-queue.constants';
import { WebhooksService } from './webhooks.service';

interface WebhookJobData {
  eventId: string;
  recordId: string;
}

@Processor(WEBHOOK_QUEUE)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    @InjectQueue(WEBHOOK_DLQ)
    private readonly dlq: Queue<WebhookJobData>,
  ) {
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

  /**
   * When a job exhausts all retries, move it to the dead-letter queue
   * for manual review. This prevents permanent data loss from transient
   * failures (Oracle blip, Stripe API outage, etc.).
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<WebhookJobData>, error: Error): Promise<void> {
    const attemptsMade = (job.attemptsMade ?? 0) + 1;
    const maxAttempts = (job.opts?.attempts as number) ?? 3;

    if (attemptsMade >= maxAttempts) {
      this.logger.error({
        message: 'Webhook job exhausted all retries — moving to DLQ',
        jobId: job.id,
        eventId: job.data.eventId,
        recordId: job.data.recordId,
        attempts: attemptsMade,
        error: error.message,
      });

      await this.dlq.add(
        `${job.data.eventId}-dlq`,
        job.data,
        {
          // Keep the dead-lettered job for manual inspection
          removeOnComplete: false,
          removeOnFail: false,
        },
      );
    }
  }
}
