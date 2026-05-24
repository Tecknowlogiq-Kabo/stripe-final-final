import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, createHash } from 'crypto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TrustRepository } from './trust.repository';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { S3Service } from '../s3/s3.service';
import { TrustIdService } from '../trustid/trustid.service';
import { EmailService } from '../email/email.service';
import { TRUSTID_WEBHOOK_QUEUE } from '../webhooks/trustid-webhook-queue.constants';
import type { TrustIdWebhookJobData } from '../webhooks/trustid-webhook.processor';

interface TrustTokenPayload {
  sub: string;    // trust token ID
  jti: string;    // unique token ID for one-time-use
  resourceType: string;
  resourceId?: string;
}

@Injectable()
export class TrustService {
  private readonly logger = new Logger(TrustService.name);
  private readonly ttlSeconds: number;
  private readonly guestLinkBaseUrl: string;

  constructor(
    private readonly repo: TrustRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly redis: RedisService,
    private readonly s3Service: S3Service,
    private readonly trustIdService: TrustIdService,
    private readonly emailService: EmailService,
    @InjectQueue(TRUSTID_WEBHOOK_QUEUE) private readonly trustIdQueue: Queue<TrustIdWebhookJobData>,
  ) {
    this.ttlSeconds = this.configService.get<number>('trust.tokenTtlSeconds') ?? 86400;
    this.guestLinkBaseUrl = this.configService.get<string>('trust.guestLinkBaseUrl') ?? 'http://localhost:3000';
  }

  /**
   * Generate a trust token using TrustID Cloud Workflow 4.
   *
   * Creates a real TrustID guest link, persists a local trust token
   * linking to the TrustID container, and returns both the local trustId
   * (JWT) and the TrustID guest URL.
   */
  async generateTrustToken(
    resourceType: string,
    resourceId: string | undefined,
    createdBy: string | undefined,
    userId: string | undefined,
    metadata: Record<string, unknown> | undefined,
    ttlSec?: number,
    email?: string,
    name?: string,
    clientRef?: string,
    branchId?: string,
    flexibleFields?: { flexibleFieldVersionId: string; fieldValueString: string }[],
    sendEmailViaUs?: boolean,
    amount?: number,
    conditionKey?: string,
  ): Promise<{ trustId: string; tokenId: string; expiresAt: Date; guestLink: string; containerId?: string }> {
    const tokenId = randomUUID();
    const jti = randomUUID();
    const effectiveTtl = ttlSec ?? this.ttlSeconds;
    const expiresAt = new Date(Date.now() + effectiveTtl * 1000);

    const payload: TrustTokenPayload = {
      sub: tokenId,
      jti,
      resourceType,
      resourceId,
    };

    const trustId = this.jwtService.sign(payload, { expiresIn: effectiveTtl });
    const tokenHash = this.hashToken(trustId);

    // Attempt to create a TrustID Cloud guest link (if configured).
    // Falls back to a local-only link if TrustID is not configured.
    let guestLink: string;
    let containerId: string | undefined;

    try {
      const guestEmail = email ?? metadata?.email as string ?? 'guest@example.com';
      const guestName = name ?? metadata?.name as string ?? 'Guest';
      const reference = clientRef ?? resourceId ?? tokenId;

      const tResult = await this.trustIdService.createGuestLink({
        email: guestEmail,
        name: guestName,
        branchId,
        applicationFlexibleFieldValues: flexibleFields ?? [],
        clientApplicationReference: reference,
        sendEmail: (metadata?.sendEmail as boolean) ?? true,
        amount,
        conditionKey,
      });

      guestLink = tResult.guestLinkUrl;
      containerId = tResult.containerId;

      // Merge TrustID container metadata into the token metadata
      const mergedMeta = {
        ...(metadata ?? {}),
        trustidContainerId: containerId,
        trustidLinkId: tResult.linkId,
        trustidGuestEmail: guestEmail,
        trustidGuestName: guestName,
      };
      metadata = mergedMeta;

      // Optionally send the guest link via our own email system
      if (sendEmailViaUs && guestEmail && guestEmail !== 'guest@example.com') {
        this.emailService
          .sendGuestLinkEmail({ to: guestEmail, name: guestName, guestLink })
          .catch((emailErr) =>
            this.logger.error({
              message: 'Failed to send guest link email',
              email: guestEmail,
              err: emailErr,
            }),
          );
      }
    } catch (err) {
      // TrustID creation failed — fall back to local-only guest link
      this.logger.warn({
        message: 'TrustID guest link creation failed, using local-only link',
        err,
      });
      guestLink = `${this.guestLinkBaseUrl}/trust/${trustId}`;
    }

    await this.repo.insert(
      tokenId,
      tokenHash,
      resourceType,
      resourceId,
      expiresAt,
      createdBy,
      userId,
      metadata ? JSON.stringify(metadata) : undefined,
      branchId,
    );

    await this.auditService.log({
      actorId: createdBy ?? 'system',
      action: 'trust_token.created',
      resourceType,
      resourceId: resourceId ?? null,
      details: JSON.stringify({
        tokenId,
        expiresAt: expiresAt.toISOString(),
        resourceType,
        containerId: containerId ?? null,
      }),
    });

    this.logger.log({
      message: 'Trust token created',
      tokenId,
      resourceType,
      resourceId,
      containerId: containerId ?? null,
      hasTrustIdLink: !!containerId,
    });

    return { trustId, tokenId, expiresAt, guestLink, containerId };
  }

  /**
   * Validate a trustId JWT and check DB status.
   * Returns null if invalid, expired, or already used.
   */
  async validateTrustToken(trustId: string): Promise<TrustTokenPayload | null> {
    try {
      const payload = this.jwtService.verify<TrustTokenPayload>(trustId);
      const tokenHash = this.hashToken(trustId);

      // Check Redis first for cached approval/denial
      const cachedStatus = await this.redis.get<string>(`trust:status:${payload.sub}`);
      if (cachedStatus === 'approved') {
        return payload; // Already approved, still valid
      }
      if (cachedStatus === 'denied' || cachedStatus === 'expired') {
        return null;
      }

      const record = await this.repo.findByTokenHash(tokenHash);
      if (!record) return null;

      if (record.status !== 'pending' && record.status !== 'submitted') {
        await this.redis.set(`trust:status:${payload.sub}`, record.status, 3600);
        return null; // Already acted upon
      }

      if (new Date() > record.expiresAt) {
        await this.repo.updateStatus(record.id, 'expired');
        await this.redis.set(`trust:status:${payload.sub}`, 'expired', 3600);
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Approve a trustId. Triggers file pull → S3 (handled by S3 module consumer).
   */
  async approve(trustId: string): Promise<boolean> {
    const payload = await this.validateTrustToken(trustId);
    if (!payload) return false;

    const record = await this.repo.findByTokenHash(this.hashToken(trustId));
    if (!record || (record.status !== 'pending' && record.status !== 'submitted')) return false;

    await this.repo.updateStatus(record.id, 'approved');
    await this.redis.set(`trust:status:${payload.sub}`, 'approved', 3600);

    await this.auditService.log({
      actorId: 'guest:trust_token',
      action: 'trust_token.approved',
      resourceType: record.resourceType,
      resourceId: record.resourceId ?? null,
      details: JSON.stringify({ tokenId: record.id }),
    });

    // Trigger S3 file pull for file-type resources with a source URL in metadata
    let s3Result: { key: string; size: number } | null = null;
    if (record.resourceType === 'file' && record.metadata) {
      try {
        const meta = JSON.parse(record.metadata) as Record<string, unknown>;
        if (meta.sourceUrl && typeof meta.sourceUrl === 'string') {
          const s3Prefix = this.configService.get<string>('aws.s3TrustPrefix') ?? 'trust-approved/';
          const baseKey = `${s3Prefix}${record.resourceId ?? record.id}/${record.id}`;
          // User-scoped path if we have a userId
          const destKey = record.userId
            ? `users/${record.userId}/${baseKey}`
            : baseKey;
          s3Result = await this.s3Service.pullAndStore(meta.sourceUrl, destKey, meta.contentType as string | undefined);
          this.logger.log({
            message: 'Trust-approved file stored in S3',
            tokenId: record.id,
            sourceUrl: meta.sourceUrl,
            s3Key: s3Result!.key,
            size: s3Result!.size,
          });
        }
      } catch (err) {
        // S3 pull failure should not block the approval
        this.logger.error({
          message: 'S3 file pull failed during trust approval',
          tokenId: record.id,
          err,
        });
      }
    }

    this.logger.log({
      message: 'Trust token approved',
      tokenId: record.id,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      s3Key: s3Result?.key ?? null,
    });

    return true;
  }

  /**
   * Deny a trustId.
   */
  async deny(trustId: string): Promise<boolean> {
    const payload = await this.validateTrustToken(trustId);
    if (!payload) return false;

    const record = await this.repo.findByTokenHash(this.hashToken(trustId));
    if (!record || (record.status !== 'pending' && record.status !== 'submitted')) return false;

    await this.repo.updateStatus(record.id, 'denied');
    await this.redis.set(`trust:status:${payload.sub}`, 'denied', 3600);

    await this.auditService.log({
      actorId: 'guest:trust_token',
      action: 'trust_token.denied',
      resourceType: record.resourceType,
      resourceId: record.resourceId ?? null,
      details: JSON.stringify({ tokenId: record.id }),
    });

    this.logger.log({
      message: 'Trust token denied',
      tokenId: record.id,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
    });

    return true;
  }

  /**
   * Link a TrustID container to a trust token and mark as submitted.
   * Called by the TrustID container-submitted webhook handler.
   */
  async linkContainerId(trustId: string, containerId: string): Promise<boolean> {
    try {
      const payload = this.jwtService.verify<TrustTokenPayload>(trustId);
      const tokenHash = this.hashToken(trustId);
      const record = await this.repo.findByTokenHash(tokenHash);

      if (!record) {
        this.logger.warn({ message: 'Trust token not found for container link', containerId });
        return false;
      }

      if (record.status !== 'pending') {
        this.logger.warn({
          message: 'Trust token not in pending state for container link',
          tokenId: record.id,
          status: record.status,
          containerId,
        });
        return false;
      }

      // Merge containerId into existing metadata
      let meta: Record<string, unknown> = {};
      if (record.metadata) {
        try {
          meta = JSON.parse(record.metadata);
        } catch { /* use empty */ }
      }
      meta.trustidContainerId = containerId;

      await this.repo.updateMetadata(record.id, JSON.stringify(meta));
      await this.repo.updateStatus(record.id, 'submitted');
      await this.redis.set(`trust:status:${payload.sub}`, 'submitted', 3600);

      await this.auditService.log({
        actorId: 'system:trustid-webhook',
        action: 'trust_token.container_submitted',
        resourceType: record.resourceType,
        resourceId: record.resourceId ?? null,
        details: JSON.stringify({ tokenId: record.id, containerId }),
      });

      this.logger.log({
        message: 'Trust token linked to TrustID container',
        tokenId: record.id,
        containerId,
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the raw DB record for a trustId (for status display).
   */
  async getTokenStatus(trustId: string): Promise<{ status: string; expiresAt: Date; metadata?: string } | null> {
    try {
      const payload = this.jwtService.verify<TrustTokenPayload>(trustId);
      const tokenHash = this.hashToken(trustId);
      const record = await this.repo.findByTokenHash(tokenHash);
      if (!record) return null;
      return { status: record.status, expiresAt: record.expiresAt, metadata: record.metadata };
    } catch {
      return null;
    }
  }

  /**
   * Safety net: re-enqueue S3 collection for approved tokens whose
   * files were never collected (job failed or went to DLQ).
   * TrustID deletes files 24h after verification — this runs every 30 min.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async reEnqueueMissedS3Collections(): Promise<void> {
    const fileRetentionHours = this.configService.get<number>('trustid.fileRetentionHours') ?? 20;
    const alertThresholdMs = (fileRetentionHours - 4) * 60 * 60 * 1000;

    const missedTokens = await this.repo.findApprovedMissingS3(5);
    if (missedTokens.length === 0) return;

    this.logger.warn({
      message: 'S3 collection safety net triggered — re-enqueueing missed collections',
      count: missedTokens.length,
    });

    for (const token of missedTokens) {
      const containerId = token.resourceId;
      if (!containerId) continue;

      await this.trustIdQueue.add(
        TRUSTID_WEBHOOK_QUEUE,
        { containerId, callbackId: 're-enqueued-safety-net' },
        { attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
      );

      // Alert if approaching deletion window
      const ageMs = Date.now() - token.updatedAt.getTime();
      if (ageMs > alertThresholdMs) {
        this.logger.error({
          message: 'CRITICAL: TrustID files at risk of deletion — S3 collection overdue',
          tokenId: token.id,
          containerId,
          ageHours: Math.floor(ageMs / 3_600_000),
          fileRetentionHours,
        });
      }
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
