import { MigrationInterface, QueryRunner } from 'typeorm';

export class NullableCustomerId1700000000006 implements MigrationInterface {
  name = 'NullableCustomerId1700000000006';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Allow guest checkout — payment intents without a customer
    // Oracle auto-generates NOT NULL constraints as SYS_Cnnnnn — find and drop it
    const [{ CONSTRAINT_NAME }] = await queryRunner.query(`
      SELECT C.CONSTRAINT_NAME
      FROM ALL_CONSTRAINTS C
      JOIN ALL_CONS_COLUMNS CC ON C.OWNER = CC.OWNER AND C.CONSTRAINT_NAME = CC.CONSTRAINT_NAME
      WHERE C.TABLE_NAME = 'STRIPE_PAYMENT_INTENTS'
        AND CC.COLUMN_NAME = 'CUSTOMER_ID'
        AND C.CONSTRAINT_TYPE = 'C'
        AND C.SEARCH_CONDITION_VC = '"CUSTOMER_ID" IS NOT NULL'
        AND C.OWNER = 'STRIPE_APP'
    `);

    if (CONSTRAINT_NAME) {
      await queryRunner.query(`
        ALTER TABLE STRIPE_PAYMENT_INTENTS DROP CONSTRAINT "${CONSTRAINT_NAME}"
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE STRIPE_PAYMENT_INTENTS MODIFY (CUSTOMER_ID CONSTRAINT NN_PI_CUSTOMER_ID NOT NULL)
    `);
  }
}