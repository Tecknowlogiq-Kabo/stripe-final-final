import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { WEBHOOK_QUEUE, WEBHOOK_DLQ } from './webhook-queue.constants';
import { WebhooksService } from './webhooks.service';

interface WebhookJobData {
  eventId: string;
  recordId: string;
}

/**
 * BullMQ worker that processes Stripe webhook events asynchronously.
 *
 * Each job is wrapped in an OTel span so Tempo shows webhook processing
 * latency in the trace waterfall.
 */
@Processor(WEBHOOK_QUEUE)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    @InjectQueue(WEBHOOK_DLQ) private readonly dlq: Queue<WebhookJobData>,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { eventId, recordId } = job.data;
    const tracer = trace.getTracer('stripe-webhooks');
    const span = tracer.startSpan('webhook.process', {
      attributes: {
        'webhook.event_id': eventId,
        'webhook.job_id': job.id ?? 'unknown',
        'webhook.attempt': job.attemptsMade + 1,
        'messaging.system': 'bullmq',
        'messaging.destination': WEBHOOK_QUEUE,
      },
    });

    this.logger.log({
      message: 'Processing webhook job',
      jobId: job.id,
      eventId,
      recordId,
      attempt: job.attemptsMade + 1,
      traceId: span.spanContext().traceId,
    });

    try {
      await this.webhooksService.execute(eventId, recordId);
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  }

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

      await this.dlq.add(`${job.data.eventId}-dlq`, job.data, {
        removeOnComplete: false,
        removeOnFail: false,
      });
    }
  }
}
