import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandPaymentMethods1700000000004 implements MigrationInterface {
  name = 'ExpandPaymentMethods1700000000004';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── STRIPE_PAYMENT_METHODS ────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE STRIPE_PAYMENT_METHODS ADD (
        DETAILS           CLOB,
        BILLING_DETAILS   CLOB,
        CARD_WALLET_TYPE  VARCHAR2(50),
        COUNTRY           VARCHAR2(2),
        FUNDING           VARCHAR2(20)
      )
    `);

    // ── STRIPE_PAYMENT_INTENTS ────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE STRIPE_PAYMENT_INTENTS ADD (
        SETUP_FUTURE_USAGE   VARCHAR2(20),
        NEXT_ACTION          CLOB,
        PAYMENT_METHOD_TYPES VARCHAR2(500),
        AMOUNT_RECEIVED      NUMBER(15,0),
        AMOUNT_CAPTURABLE    NUMBER(15,0),
        RECEIPT_EMAIL        VARCHAR2(255),
        STATEMENT_DESCRIPTOR VARCHAR2(22),
        LIVEMODE             NUMBER(1) DEFAULT 0 NOT NULL
      )
    `);

    // ── STRIPE_SETUP_INTENTS ──────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE STRIPE_SETUP_INTENTS ADD (
        PAYMENT_METHOD_TYPES VARCHAR2(500),
        USAGE                VARCHAR2(20),
        LAST_SETUP_ERROR     CLOB,
        NEXT_ACTION          CLOB,
        LIVEMODE             NUMBER(1) DEFAULT 0 NOT NULL
      )
    `);

    // ── Analytical index for payment routing / reporting ──────────────────────
    await queryRunner.query(`
      CREATE INDEX IDX_PM_TYPE_COUNTRY ON STRIPE_PAYMENT_METHODS(TYPE, COUNTRY)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IDX_PM_TYPE_COUNTRY`);

    await queryRunner.query(`
      ALTER TABLE STRIPE_SETUP_INTENTS DROP (
        PAYMENT_METHOD_TYPES, USAGE, LAST_SETUP_ERROR, NEXT_ACTION, LIVEMODE
      )
    `);

    await queryRunner.query(`
      ALTER TABLE STRIPE_PAYMENT_INTENTS DROP (
        SETUP_FUTURE_USAGE, NEXT_ACTION, PAYMENT_METHOD_TYPES,
        AMOUNT_RECEIVED, AMOUNT_CAPTURABLE, RECEIPT_EMAIL,
        STATEMENT_DESCRIPTOR, LIVEMODE
      )
    `);

    await queryRunner.query(`
      ALTER TABLE STRIPE_PAYMENT_METHODS DROP (
        DETAILS, BILLING_DETAILS, CARD_WALLET_TYPE, COUNTRY, FUNDING
      )
    `);
  }
}
