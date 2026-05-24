import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates BILLING_RECORDS and NOTIFICATIONS tables.
 *
 * BILLING_RECORDS tracks per-subscription charge cycles including lock/charge
 * lifecycle and Stripe PaymentIntent linkage.
 *
 * NOTIFICATIONS stores customer-facing in-app notifications with read state.
 */
export class CreateBillingRecordsNotifications1700000000009
  implements MigrationInterface
{
  name = 'CreateBillingRecordsNotifications1700000000009';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE BILLING_RECORDS (
        ID                       VARCHAR2(36)   DEFAULT SYS_GUID() NOT NULL,
        SUBSCRIPTION_ID          VARCHAR2(36)   NOT NULL,
        CHARGE_AMOUNT            NUMBER(15,0)   NOT NULL,
        CURRENCY                 VARCHAR2(3)    DEFAULT 'usd'     NOT NULL,
        STATUS                   VARCHAR2(20)   DEFAULT 'pending' NOT NULL,
        PERIOD_DATE              DATE           NOT NULL,
        LOCKED_AT                TIMESTAMP,
        CHARGED_AT               TIMESTAMP,
        STRIPE_PAYMENT_INTENT_ID VARCHAR2(100),
        FAILURE_MESSAGE          VARCHAR2(4000),
        CREATED_AT               TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UPDATED_AT               TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CONSTRAINT PK_BILLING_RECORDS    PRIMARY KEY (ID),
        CONSTRAINT FK_BR_SUBSCRIPTION    FOREIGN KEY (SUBSCRIPTION_ID)
            REFERENCES STRIPE_SUBSCRIPTIONS(ID) ON DELETE CASCADE,
        CONSTRAINT CHK_BR_STATUS CHECK (STATUS IN ('pending','locked','charged','failed'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_BR_SUB_PERIOD ON BILLING_RECORDS(SUBSCRIPTION_ID, PERIOD_DATE)
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_BR_STATUS ON BILLING_RECORDS(STATUS)
    `);

    await queryRunner.query(`
      CREATE TABLE NOTIFICATIONS (
        ID          VARCHAR2(36)   DEFAULT SYS_GUID() NOT NULL,
        CUSTOMER_ID VARCHAR2(36)   NOT NULL,
        TYPE        VARCHAR2(50)   NOT NULL,
        TITLE       VARCHAR2(255)  NOT NULL,
        MESSAGE     VARCHAR2(4000) NOT NULL,
        IS_READ     NUMBER(1)      DEFAULT 0 NOT NULL,
        METADATA    CLOB,
        CREATED_AT  TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CONSTRAINT PK_NOTIFICATIONS   PRIMARY KEY (ID),
        CONSTRAINT FK_NOTIF_CUSTOMER  FOREIGN KEY (CUSTOMER_ID)
            REFERENCES STRIPE_CUSTOMERS(ID) ON DELETE CASCADE,
        CONSTRAINT CHK_NOTIF_READ CHECK (IS_READ IN (0,1))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_NOTIF_CUSTOMER_READ ON NOTIFICATIONS(CUSTOMER_ID, IS_READ)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IDX_NOTIF_CUSTOMER_READ`);
    await queryRunner.query(`DROP TABLE NOTIFICATIONS`);
    await queryRunner.query(`DROP INDEX IDX_BR_STATUS`);
    await queryRunner.query(`DROP INDEX IDX_BR_SUB_PERIOD`);
    await queryRunner.query(`DROP TABLE BILLING_RECORDS`);
  }
}
