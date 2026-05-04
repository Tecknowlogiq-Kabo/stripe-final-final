import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsersTable1700000000003 implements MigrationInterface {
  name = 'AddUsersTable1700000000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE APP_USERS (
        ID            VARCHAR2(36)  DEFAULT SYS_GUID() NOT NULL,
        EMAIL         VARCHAR2(255) NOT NULL,
        PASSWORD_HASH VARCHAR2(255) NOT NULL,
        CREATED_AT    TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
        UPDATED_AT    TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT PK_APP_USERS       PRIMARY KEY (ID),
        CONSTRAINT UQ_APP_USERS_EMAIL UNIQUE (EMAIL)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE APP_USERS`);
  }
}
