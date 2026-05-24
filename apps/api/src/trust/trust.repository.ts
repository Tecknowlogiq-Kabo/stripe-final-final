import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TrustToken } from '../entities/trust-token.entity';

@Injectable()
export class TrustRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async insert(
    id: string,
    tokenHash: string,
    resourceType: string,
    resourceId: string | undefined,
    expiresAt: Date,
    createdBy: string | undefined,
    userId: string | undefined,
    metadata: string | undefined,
    branchId?: string,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO TRUST_TOKENS (ID, TOKEN_HASH, RESOURCE_TYPE, RESOURCE_ID, STATUS, EXPIRES_AT, CREATED_BY, USER_ID, METADATA, BRANCH_ID, RETRY_COUNT, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, 0, SYSDATE, SYSDATE)`,
      [id, tokenHash, resourceType, resourceId ?? null, 'pending', expiresAt, createdBy ?? null, userId ?? null, metadata ?? null, branchId ?? null],
    );
  }

  async findByTokenHash(tokenHash: string): Promise<TrustToken | null> {
    const [row] = await this.dataSource.query<TrustToken[]>(
      `SELECT ID AS "id", TOKEN_HASH AS "tokenHash", RESOURCE_TYPE AS "resourceType", RESOURCE_ID AS "resourceId", STATUS AS "status", EXPIRES_AT AS "expiresAt", CREATED_BY AS "createdBy", USER_ID AS "userId", METADATA AS "metadata", BRANCH_ID AS "branchId", S3_COLLECTED_AT AS "s3CollectedAt", RETRY_COUNT AS "retryCount", RETRY_BRANCH_ID AS "retryBranchId", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"
       FROM TRUST_TOKENS WHERE TOKEN_HASH = :1 AND ROWNUM = 1`,
      [tokenHash],
    );
    return row ?? null;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE TRUST_TOKENS SET STATUS = :1, UPDATED_AT = SYSDATE WHERE ID = :2`,
      [status, id],
    );
  }

  async expireStale(): Promise<number> {
    const result = await this.dataSource.query(
      `UPDATE TRUST_TOKENS SET STATUS = 'expired', UPDATED_AT = SYSDATE WHERE STATUS = 'pending' AND EXPIRES_AT < SYSDATE`,
    );
    return result.rowsAffected ?? 0;
  }

  /**
   * Find a trust token by its resourceId.
   * Used by TrustID webhook handlers to map ContainerId → trust token.
   */
  async findByResourceId(resourceId: string): Promise<TrustToken | null> {
    const [row] = await this.dataSource.query<TrustToken[]>(
      `SELECT ID AS "id", TOKEN_HASH AS "tokenHash", RESOURCE_TYPE AS "resourceType", RESOURCE_ID AS "resourceId", STATUS AS "status", EXPIRES_AT AS "expiresAt", CREATED_BY AS "createdBy", USER_ID AS "userId", METADATA AS "metadata", BRANCH_ID AS "branchId", S3_COLLECTED_AT AS "s3CollectedAt", RETRY_COUNT AS "retryCount", RETRY_BRANCH_ID AS "retryBranchId", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"
       FROM TRUST_TOKENS WHERE RESOURCE_ID = :1 AND ROWNUM = 1`,
      [resourceId],
    );
    return row ?? null;
  }

  /**
   * Update just the metadata JSON field on a trust token.
   */
  async updateMetadata(id: string, metadata: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE TRUST_TOKENS SET METADATA = :1, UPDATED_AT = SYSDATE WHERE ID = :2`,
      [metadata, id],
    );
  }

  /**
   * Find all trust tokens for a given user.
   */
  async findByUserId(userId: string): Promise<TrustToken[]> {
    return this.dataSource.query<TrustToken[]>(
      `SELECT ID AS "id", TOKEN_HASH AS "tokenHash", RESOURCE_TYPE AS "resourceType", RESOURCE_ID AS "resourceId", STATUS AS "status", EXPIRES_AT AS "expiresAt", CREATED_BY AS "createdBy", USER_ID AS "userId", METADATA AS "metadata", BRANCH_ID AS "branchId", S3_COLLECTED_AT AS "s3CollectedAt", RETRY_COUNT AS "retryCount", RETRY_BRANCH_ID AS "retryBranchId", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"
       FROM TRUST_TOKENS WHERE USER_ID = :1 ORDER BY CREATED_AT DESC`,
      [userId],
    );
  }

  /** Mark S3 collection as complete for a trust token. */
  async markS3Collected(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE TRUST_TOKENS SET S3_COLLECTED_AT = SYSDATE, UPDATED_AT = SYSDATE WHERE ID = :1`,
      [id],
    );
  }

  /** Increment retry count and record the retry branch used. */
  async incrementRetryCount(id: string, retryBranchId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE TRUST_TOKENS SET RETRY_COUNT = NVL(RETRY_COUNT, 0) + 1, RETRY_BRANCH_ID = :1, UPDATED_AT = SYSDATE WHERE ID = :2`,
      [retryBranchId, id],
    );
  }

  /**
   * Find approved tokens where S3 collection has not been recorded,
   * updated more than `olderThanMinutes` ago (to skip in-flight jobs).
   */
  async findApprovedMissingS3(olderThanMinutes: number): Promise<TrustToken[]> {
    return this.dataSource.query<TrustToken[]>(
      `SELECT ID AS "id", TOKEN_HASH AS "tokenHash", RESOURCE_TYPE AS "resourceType", RESOURCE_ID AS "resourceId", STATUS AS "status", EXPIRES_AT AS "expiresAt", CREATED_BY AS "createdBy", USER_ID AS "userId", METADATA AS "metadata", BRANCH_ID AS "branchId", S3_COLLECTED_AT AS "s3CollectedAt", RETRY_COUNT AS "retryCount", RETRY_BRANCH_ID AS "retryBranchId", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"
       FROM TRUST_TOKENS
       WHERE STATUS = 'approved'
         AND S3_COLLECTED_AT IS NULL
         AND UPDATED_AT < SYSDATE - INTERVAL '${olderThanMinutes}' MINUTE
       ORDER BY UPDATED_AT ASC`,
    );
  }
}
