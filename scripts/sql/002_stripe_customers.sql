-- =============================================================================
-- Table : STRIPE_CUSTOMERS
-- Purpose: Stripe customer records linked to APP_USERS (optional)
-- Source : apps/api/src/entities/stripe-customer.entity.ts
--          Migrations 001, 002, 005
-- FK deps: APP_USERS (USER_ID)
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE STRIPE_CUSTOMERS (
      ID                 VARCHAR2(36)  DEFAULT SYS_GUID() NOT NULL, -- UUID primary key
      STRIPE_CUSTOMER_ID VARCHAR2(50)  NOT NULL,                    -- cus_xxx from Stripe
      EMAIL              VARCHAR2(255) NOT NULL,                     -- Customer email
      NAME               VARCHAR2(255),                              -- Display name (nullable)
      PHONE              VARCHAR2(50),                               -- E.164 phone (nullable)
      METADATA           CLOB,                                       -- JSON metadata from Stripe
      IDEMPOTENCY_KEY    VARCHAR2(255),                              -- Idempotency key for creates
      USER_ID            VARCHAR2(36),                               -- FK -> APP_USERS (nullable)
      IS_DELETED         NUMBER(1)     DEFAULT 0 NOT NULL,           -- Soft-delete flag (0/1)
      CREATED_AT         TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT         TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT PK_STRIPE_CUSTOMERS     PRIMARY KEY (ID),
      CONSTRAINT UQ_STRIPE_CUSTOMERS_SID UNIQUE (STRIPE_CUSTOMER_ID),
      CONSTRAINT UQ_CUSTOMER_EMAIL       UNIQUE (EMAIL),
      CONSTRAINT FK_CUSTOMER_USER        FOREIGN KEY (USER_ID)
        REFERENCES APP_USERS(ID) ON DELETE SET NULL,
      CONSTRAINT CHK_STRIPE_CUST_DELETED CHECK (IS_DELETED IN (0, 1))
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- Indexes from migrations 002 and 005
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_CUSTOMERS_IS_DELETED ON STRIPE_CUSTOMERS(IS_DELETED)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_CUSTOMER_IDEMPOTENCY ON STRIPE_CUSTOMERS(IDEMPOTENCY_KEY)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_CUSTOMER_USER ON STRIPE_CUSTOMERS(USER_ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
