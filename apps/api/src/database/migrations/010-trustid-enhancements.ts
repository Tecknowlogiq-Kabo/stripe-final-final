import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrustidEnhancements1748000000000 implements MigrationInterface {
  name = 'TrustidEnhancements1748000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE TRUST_TOKENS ADD (
        BRANCH_ID      VARCHAR2(100),
        S3_COLLECTED_AT TIMESTAMP,
        RETRY_COUNT    NUMBER DEFAULT 0,
        RETRY_BRANCH_ID VARCHAR2(100)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_TT_S3_COLLECTED ON TRUST_TOKENS (STATUS, S3_COLLECTED_AT, UPDATED_AT)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IDX_TT_S3_COLLECTED`);
    await queryRunner.query(`ALTER TABLE TRUST_TOKENS DROP (BRANCH_ID, S3_COLLECTED_AT, RETRY_COUNT, RETRY_BRANCH_ID)`);
  }
}
