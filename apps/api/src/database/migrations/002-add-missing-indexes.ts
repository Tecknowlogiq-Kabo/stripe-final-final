import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingIndexes1700000000002 implements MigrationInterface {
  name = 'AddMissingIndexes1700000000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    // STRIPE_CUSTOMERS — email lookup (duplicate check on every create)
    await queryRunner.query(
      `CREATE INDEX IDX_CUSTOMERS_EMAIL ON STRIPE_CUSTOMERS(EMAIL)`,
    );
    // STRIPE_CUSTOMERS — soft-delete filter (used on almost every query)
    await queryRunner.query(
      `CREATE INDEX IDX_CUSTOMERS_IS_DELETED ON STRIPE_CUSTOMERS(IS_DELETED)`,
    );
    // STRIPE_CUSTOMERS — idempotency key lookup (checked on every write)
    await queryRunner.query(
      `CREATE INDEX IDX_CUSTOMER_IDEMPOTENCY ON STRIPE_CUSTOMERS(IDEMPOTENCY_KEY)`,
    );

    // STRIPE_PAYMENT_INTENTS — idempotency key lookup
    await queryRunner.query(
      `CREATE INDEX IDX_PI_IDEMPOTENCY ON STRIPE_PAYMENT_INTENTS(IDEMPOTENCY_KEY)`,
    );
    // STRIPE_PAYMENT_INTENTS — composite for reporting queries (customer + date range)
    await queryRunner.query(
      `CREATE INDEX IDX_PI_CUSTOMER_CREATED ON STRIPE_PAYMENT_INTENTS(CUSTOMER_ID, CREATED_AT)`,
    );

    // STRIPE_SETUP_INTENTS — idempotency key lookup
    await queryRunner.query(
      `CREATE INDEX IDX_SI_IDEMPOTENCY ON STRIPE_SETUP_INTENTS(IDEMPOTENCY_KEY)`,
    );

    // STRIPE_SUBSCRIPTIONS — composite for listByCustomer filtered by status
    await queryRunner.query(
      `CREATE INDEX IDX_SUB_CUSTOMER_STATUS ON STRIPE_SUBSCRIPTIONS(CUSTOMER_ID, STATUS)`,
    );

    // SUBSCRIPTION_PLANS — active plan filter (used in listPlans on every page load)
    await queryRunner.query(
      `CREATE INDEX IDX_PLANS_IS_ACTIVE ON SUBSCRIPTION_PLANS(IS_ACTIVE)`,
    );

    // STRIPE_WEBHOOK_EVENTS — composite for webhook health reporting
    await queryRunner.query(
      `CREATE INDEX IDX_WH_EVENT_TYPE_STATUS ON STRIPE_WEBHOOK_EVENTS(EVENT_TYPE, STATUS)`,
    );

    // STRIPE_WEBHOOK_EVENTS — add UPDATED_AT column (missing from initial schema)
    await queryRunner.query(
      `ALTER TABLE STRIPE_WEBHOOK_EVENTS ADD (UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE STRIPE_WEBHOOK_EVENTS DROP COLUMN UPDATED_AT`);
    await queryRunner.query(`DROP INDEX IDX_WH_EVENT_TYPE_STATUS`);
    await queryRunner.query(`DROP INDEX IDX_PLANS_IS_ACTIVE`);
    await queryRunner.query(`DROP INDEX IDX_SUB_CUSTOMER_STATUS`);
    await queryRunner.query(`DROP INDEX IDX_SI_IDEMPOTENCY`);
    await queryRunner.query(`DROP INDEX IDX_PI_CUSTOMER_CREATED`);
    await queryRunner.query(`DROP INDEX IDX_PI_IDEMPOTENCY`);
    await queryRunner.query(`DROP INDEX IDX_CUSTOMER_IDEMPOTENCY`);
    await queryRunner.query(`DROP INDEX IDX_CUSTOMERS_IS_DELETED`);
    await queryRunner.query(`DROP INDEX IDX_CUSTOMERS_EMAIL`);
  }
}
