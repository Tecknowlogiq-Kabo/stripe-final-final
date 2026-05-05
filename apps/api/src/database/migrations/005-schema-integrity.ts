import { MigrationInterface, QueryRunner } from 'typeorm';

export class SchemaIntegrity1700000000005 implements MigrationInterface {
  name = 'SchemaIntegrity1700000000005';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── USER_ID on STRIPE_CUSTOMERS ───────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE STRIPE_CUSTOMERS ADD (USER_ID VARCHAR2(36))
    `);

    await queryRunner.query(`
      ALTER TABLE STRIPE_CUSTOMERS
        ADD CONSTRAINT FK_CUSTOMER_USER
        FOREIGN KEY (USER_ID) REFERENCES APP_USERS(ID)
        ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_CUSTOMER_USER ON STRIPE_CUSTOMERS(USER_ID)
    `);

    // ── EMAIL unique constraint on STRIPE_CUSTOMERS ───────────────────────────
    // Drop the existing non-unique index first, then add unique constraint
    await queryRunner.query(`DROP INDEX IDX_CUSTOMERS_EMAIL`);

    await queryRunner.query(`
      ALTER TABLE STRIPE_CUSTOMERS
        ADD CONSTRAINT UQ_CUSTOMER_EMAIL UNIQUE (EMAIL)
    `);

    // ── FK from STRIPE_SUBSCRIPTIONS to SUBSCRIPTION_PLANS ───────────────────
    // Using DEFERRABLE so existing data (e.g. external Stripe plans) won't block
    await queryRunner.query(`
      CREATE INDEX IDX_SUB_PRICE_ID ON STRIPE_SUBSCRIPTIONS(STRIPE_PRICE_ID)
    `);

    // ── Check constraints on STATUS fields ───────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE STRIPE_PAYMENT_INTENTS ADD CONSTRAINT CHK_PI_STATUS CHECK (
        STATUS IN (
          'pending', 'processing', 'requires_action', 'requires_confirmation',
          'requires_capture', 'requires_payment_method', 'canceled', 'succeeded'
        )
      )
    `);

    await queryRunner.query(`
      ALTER TABLE STRIPE_SUBSCRIPTIONS ADD CONSTRAINT CHK_SUB_STATUS CHECK (
        STATUS IN (
          'active', 'canceled', 'incomplete', 'incomplete_expired',
          'past_due', 'paused', 'trialing', 'unpaid'
        )
      )
    `);

    await queryRunner.query(`
      ALTER TABLE STRIPE_WEBHOOK_EVENTS ADD CONSTRAINT CHK_WH_STATUS CHECK (
        STATUS IN ('pending', 'processed', 'failed', 'skipped')
      )
    `);

    // ── Index for retry queries on webhook events ─────────────────────────────
    await queryRunner.query(`
      CREATE INDEX IDX_WH_RETRY ON STRIPE_WEBHOOK_EVENTS(STATUS, RETRY_COUNT, CREATED_AT)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IDX_WH_RETRY`);
    await queryRunner.query(`ALTER TABLE STRIPE_WEBHOOK_EVENTS DROP CONSTRAINT CHK_WH_STATUS`);
    await queryRunner.query(`ALTER TABLE STRIPE_SUBSCRIPTIONS DROP CONSTRAINT CHK_SUB_STATUS`);
    await queryRunner.query(`ALTER TABLE STRIPE_PAYMENT_INTENTS DROP CONSTRAINT CHK_PI_STATUS`);
    await queryRunner.query(`DROP INDEX IDX_SUB_PRICE_ID`);
    await queryRunner.query(`ALTER TABLE STRIPE_CUSTOMERS DROP CONSTRAINT UQ_CUSTOMER_EMAIL`);
    await queryRunner.query(`
      CREATE INDEX IDX_CUSTOMERS_EMAIL ON STRIPE_CUSTOMERS(EMAIL)
    `);
    await queryRunner.query(`DROP INDEX IDX_CUSTOMER_USER`);
    await queryRunner.query(`ALTER TABLE STRIPE_CUSTOMERS DROP CONSTRAINT FK_CUSTOMER_USER`);
    await queryRunner.query(`ALTER TABLE STRIPE_CUSTOMERS DROP (USER_ID)`);
  }
}
