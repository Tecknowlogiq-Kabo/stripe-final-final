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
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO TRUST_TOKENS (ID, TOKEN_HASH, RESOURCE_TYPE, RESOURCE_ID, STATUS, EXPIRES_AT, CREATED_BY, USER_ID, METADATA, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, SYSDATE, SYSDATE)`,
      [id, tokenHash, resourceType, resourceId ?? null, 'pending', expiresAt, createdBy ?? null, userId ?? null, metadata ?? null],
    );
  }

  async findByTokenHash(tokenHash: string): Promise<TrustToken | null> {
    const [row] = await this.dataSource.query<TrustToken[]>(
      `SELECT ID AS "id", TOKEN_HASH AS "tokenHash", RESOURCE_TYPE AS "resourceType", RESOURCE_ID AS "resourceId", STATUS AS "status", EXPIRES_AT AS "expiresAt", CREATED_BY AS "createdBy", USER_ID AS "userId", METADATA AS "metadata", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"
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
      `SELECT ID AS "id", TOKEN_HASH AS "tokenHash", RESOURCE_TYPE AS "resourceType", RESOURCE_ID AS "resourceId", STATUS AS "status", EXPIRES_AT AS "expiresAt", CREATED_BY AS "createdBy", USER_ID AS "userId", METADATA AS "metadata", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"
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
      `SELECT ID AS "id", TOKEN_HASH AS "tokenHash", RESOURCE_TYPE AS "resourceType", RESOURCE_ID AS "resourceId", STATUS AS "status", EXPIRES_AT AS "expiresAt", CREATED_BY AS "createdBy", USER_ID AS "userId", METADATA AS "metadata", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"
       FROM TRUST_TOKENS WHERE USER_ID = :1 ORDER BY CREATED_AT DESC`,
      [userId],
    );
  }
}
