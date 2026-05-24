-- =============================================================================
-- Table : STRIPE_SETUP_INTENTS
-- Purpose: Stripe SetupIntent records (save PM for future use without charge)
-- Source : apps/api/src/entities/stripe-setup-intent.entity.ts
--          Migrations 001, 002, 004
-- FK deps: STRIPE_CUSTOMERS (CUSTOMER_ID)
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE STRIPE_SETUP_INTENTS (
      ID                   VARCHAR2(36)  DEFAULT SYS_GUID() NOT NULL, -- UUID primary key
      STRIPE_SI_ID         VARCHAR2(100) NOT NULL,                    -- seti_xxx from Stripe
      STATUS               VARCHAR2(50)  NOT NULL,                    -- Stripe SI status
      CLIENT_SECRET        VARCHAR2(500) NOT NULL,                    -- Frontend confirmation secret
      CUSTOMER_ID          VARCHAR2(36)  NOT NULL,                    -- FK -> STRIPE_CUSTOMERS
      STRIPE_PM_ID         VARCHAR2(100),                             -- PM attached on success
      IDEMPOTENCY_KEY      VARCHAR2(255),                             -- Idempotency key for creates
      METADATA             CLOB,                                      -- JSON metadata
      DESCRIPTION          VARCHAR2(4000),                            -- Human-readable description
      PAYMENT_METHOD_TYPES VARCHAR2(500),                             -- Allowed PM types (JSON/CSV)
      USAGE                VARCHAR2(20),                              -- off_session | on_session
      LAST_SETUP_ERROR     CLOB,                                      -- JSON last error object
      NEXT_ACTION          CLOB,                                      -- JSON next_action object
      LIVEMODE             NUMBER(1)     DEFAULT 0 NOT NULL,          -- 0=test, 1=live
      CREATED_AT           TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT           TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT PK_STRIPE_SETUP_INTENTS PRIMARY KEY (ID),
      CONSTRAINT UQ_STRIPE_SI_SID        UNIQUE (STRIPE_SI_ID),
      CONSTRAINT FK_STRIPE_SI_CUSTOMER   FOREIGN KEY (CUSTOMER_ID)
        REFERENCES STRIPE_CUSTOMERS(ID),
      CONSTRAINT CHK_SI_LIVEMODE         CHECK (LIVEMODE IN (0, 1))
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- Indexes from migrations 001 and 002
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_SI_CUSTOMER ON STRIPE_SETUP_INTENTS(CUSTOMER_ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_SI_IDEMPOTENCY ON STRIPE_SETUP_INTENTS(IDEMPOTENCY_KEY)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
