import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the missing FK constraint from STRIPE_SUBSCRIPTIONS(STRIPE_PRICE_ID)
 * to SUBSCRIPTION_PLANS(STRIPE_PRICE_ID).
 *
 * Migration 005 created the index (IDX_SUB_PRICE_ID) but never added the FK.
 * This allows plan deletion while active subscriptions reference the deleted plan,
 * resulting in NULL plan data in join queries.
 */
export class AddSubscriptionPlanFk1700000000007 implements MigrationInterface {
  name = 'AddSubscriptionPlanFk1700000000007';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Backfill: ensure every subscription has a valid plan reference.
    // If any subscription references a price not in SUBSCRIPTION_PLANS,
    // we set it to NULL (the subscription remains, plan data will be missing).
    await queryRunner.query(`
      UPDATE STRIPE_SUBSCRIPTIONS s
      SET STRIPE_PRICE_ID = NULL
      WHERE STRIPE_PRICE_ID IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM SUBSCRIPTION_PLANS p
          WHERE p.STRIPE_PRICE_ID = s.STRIPE_PRICE_ID
        )
    `);

    // Add the FK with ON DELETE RESTRICT so plans with active subscriptions
    // cannot be deleted without explicitly handling the subscriptions first.
    await queryRunner.query(`
      ALTER TABLE STRIPE_SUBSCRIPTIONS
        ADD CONSTRAINT FK_SUB_PRICE_ID
        FOREIGN KEY (STRIPE_PRICE_ID) REFERENCES SUBSCRIPTION_PLANS(STRIPE_PRICE_ID)
        ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE STRIPE_SUBSCRIPTIONS DROP CONSTRAINT FK_SUB_PRICE_ID
    `);
  }
}
