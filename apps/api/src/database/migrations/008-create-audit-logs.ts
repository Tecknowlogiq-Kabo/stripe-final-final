import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the AUDIT_LOGS table for SOC2/GDPR compliance.
 *
 * Records who did what to which resource, when, and from where.
 * Required for:
 *   - SOC2: audit trail of system activity
 *   - GDPR: data access records (who accessed PII and when)
 *   - Security: forensic investigation of incidents
 *
 * Retention policy: 90 days (enforced by RETENTION_DATE column).
 * PII in old records should be purged after RETENTION_DATE passes.
 */
export class CreateAuditLogs1700000000008 implements MigrationInterface {
  name = 'CreateAuditLogs1700000000008';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE AUDIT_LOGS (
        ID               VARCHAR2(36)  NOT NULL PRIMARY KEY,
        ACTOR_ID         VARCHAR2(36)  NOT NULL,
        ACTOR_EMAIL      VARCHAR2(255),
        ACTION           VARCHAR2(100) NOT NULL,
        RESOURCE_TYPE    VARCHAR2(100) NOT NULL,
        RESOURCE_ID      VARCHAR2(36),
        DETAILS          CLOB,
        IP_ADDRESS       VARCHAR2(45),
        USER_AGENT       VARCHAR2(500),
        CORRELATION_ID   VARCHAR2(36),
        STATUS           VARCHAR2(20)  DEFAULT 'success',
        CREATED_AT       TIMESTAMP     DEFAULT SYSDATE,
        RETENTION_DATE   TIMESTAMP     DEFAULT SYSDATE + 90
      )
    `);

    // Index for querying by actor (user activity feeds, GDPR access requests)
    await queryRunner.query(`
      CREATE INDEX IDX_AUDIT_ACTOR ON AUDIT_LOGS(ACTOR_ID, CREATED_AT)
    `);

    // Index for querying by resource (who accessed this customer's data?)
    await queryRunner.query(`
      CREATE INDEX IDX_AUDIT_RESOURCE ON AUDIT_LOGS(RESOURCE_TYPE, RESOURCE_ID, CREATED_AT)
    `);

    // Index for retention purge jobs
    await queryRunner.query(`
      CREATE INDEX IDX_AUDIT_RETENTION ON AUDIT_LOGS(RETENTION_DATE)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IDX_AUDIT_RETENTION`);
    await queryRunner.query(`DROP INDEX IDX_AUDIT_RESOURCE`);
    await queryRunner.query(`DROP INDEX IDX_AUDIT_ACTOR`);
    await queryRunner.query(`DROP TABLE AUDIT_LOGS`);
  }
}
