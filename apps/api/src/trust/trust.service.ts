import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, createHash } from 'crypto';
import { TrustRepository } from './trust.repository';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { S3Service } from '../s3/s3.service';

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
  ) {
    this.ttlSeconds = this.configService.get<number>('trust.tokenTtlSeconds') ?? 86400;
    this.guestLinkBaseUrl = this.configService.get<string>('trust.guestLinkBaseUrl') ?? 'http://localhost:3000';
  }

  /**
   * Generate a new trustId token and persist its hash.
   * Returns the raw JWT (trustId) for the guest link.
   */
  async generateTrustToken(
    resourceType: string,
    resourceId: string | undefined,
    createdBy: string | undefined,
    metadata: Record<string, unknown> | undefined,
    ttlSec?: number,
  ): Promise<{ trustId: string; tokenId: string; expiresAt: Date; guestLink: string }> {
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

    await this.repo.insert(
      tokenId,
      tokenHash,
      resourceType,
      resourceId,
      expiresAt,
      createdBy,
      metadata ? JSON.stringify(metadata) : undefined,
    );

    const guestLink = `${this.guestLinkBaseUrl}/trust/${trustId}`;

    await this.auditService.log({
      actorId: createdBy ?? 'system',
      action: 'trust_token.created',
      resourceType,
      resourceId: resourceId ?? null,
      details: JSON.stringify({ tokenId, expiresAt: expiresAt.toISOString(), resourceType }),
    });

    this.logger.log({
      message: 'Trust token created',
      tokenId,
      resourceType,
      resourceId,
      expiresAt: expiresAt.toISOString(),
    });

    return { trustId, tokenId, expiresAt, guestLink };
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

      if (record.status !== 'pending') {
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
    if (!record || record.status !== 'pending') return false;

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
          const destKey = `${s3Prefix}${record.resourceId ?? record.id}/${record.id}`;
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
    if (!record || record.status !== 'pending') return false;

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

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
