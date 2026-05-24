-- =============================================================================
-- Table : APP_USERS
-- Purpose: Application user accounts (email/password, roles)
-- Source : apps/api/src/entities/user.entity.ts
--          Migration 003-add-users-table.ts
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE APP_USERS (
      ID            VARCHAR2(36)  DEFAULT SYS_GUID() NOT NULL,  -- UUID primary key
      EMAIL         VARCHAR2(255) NOT NULL,                      -- Unique login email
      PASSWORD_HASH VARCHAR2(255) NOT NULL,                      -- bcrypt hash; never plaintext
      ROLE          VARCHAR2(20)  DEFAULT ''user'' NOT NULL,     -- user | admin
      CREATED_AT    TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT    TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT PK_APP_USERS       PRIMARY KEY (ID),
      CONSTRAINT UQ_APP_USERS_EMAIL UNIQUE (EMAIL),
      CONSTRAINT CHK_APP_USERS_ROLE CHECK (ROLE IN (''user'', ''admin''))
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF; -- -955 = ORA-00955 table already exists
END;
/
