-- =============================================================================
-- Table : STRIPE_PAYMENT_INTENTS
-- Purpose: Stripe PaymentIntent records (charge lifecycle)
-- Source : apps/api/src/entities/stripe-payment-intent.entity.ts
--          Migrations 001, 002, 004, 005, 006
-- FK deps: STRIPE_CUSTOMERS (CUSTOMER_ID, nullable for guest checkout)
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE STRIPE_PAYMENT_INTENTS (
      ID                   VARCHAR2(36)  DEFAULT SYS_GUID() NOT NULL, -- UUID primary key
      STRIPE_PI_ID         VARCHAR2(100) NOT NULL,                    -- pi_xxx from Stripe
      AMOUNT               NUMBER(15,0)  NOT NULL,                    -- Smallest currency unit
      CURRENCY             VARCHAR2(3)   NOT NULL,                    -- ISO 4217, e.g. usd
      STATUS               VARCHAR2(50)  NOT NULL,                    -- Stripe PI status
      CLIENT_SECRET        VARCHAR2(500) NOT NULL,                    -- Frontend confirmation secret
      CUSTOMER_ID          VARCHAR2(36),                              -- FK -> STRIPE_CUSTOMERS (nullable: guest checkout)
      STRIPE_PM_ID         VARCHAR2(100),                             -- Stripe payment method ID used
      IDEMPOTENCY_KEY      VARCHAR2(255),                             -- Idempotency key for creates
      METADATA             CLOB,                                      -- JSON metadata
      DESCRIPTION          VARCHAR2(4000),                            -- Human-readable description
      ERROR_CODE           VARCHAR2(100),                             -- Stripe decline code
      ERROR_DECLINE_CODE   VARCHAR2(100),                             -- Stripe error decline code
      ERROR_MESSAGE        VARCHAR2(4000),                            -- User-facing error text
      SETUP_FUTURE_USAGE   VARCHAR2(20),                              -- off_session | on_session
      NEXT_ACTION          CLOB,                                      -- JSON next_action object
      PAYMENT_METHOD_TYPES VARCHAR2(500),                             -- Comma-sep allowed PM types
      AMOUNT_RECEIVED      NUMBER(15,0),                              -- Amount actually captured
      AMOUNT_CAPTURABLE    NUMBER(15,0),                              -- Amount available to capture
      RECEIPT_EMAIL        VARCHAR2(255),                             -- Where to send receipt
      STATEMENT_DESCRIPTOR VARCHAR2(22),                              -- Bank statement text (max 22)
      LIVEMODE             NUMBER(1)     DEFAULT 0 NOT NULL,          -- 0=test, 1=live
      CREATED_AT           TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT           TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT PK_STRIPE_PAYMENT_INTENTS     PRIMARY KEY (ID),
      CONSTRAINT UQ_STRIPE_PI_SID              UNIQUE (STRIPE_PI_ID),
      CONSTRAINT FK_STRIPE_PI_CUSTOMER         FOREIGN KEY (CUSTOMER_ID)
        REFERENCES STRIPE_CUSTOMERS(ID),
      CONSTRAINT CHK_PI_STATUS CHECK (
        STATUS IN (
          ''pending'', ''processing'', ''requires_action'', ''requires_confirmation'',
          ''requires_capture'', ''requires_payment_method'', ''canceled'', ''succeeded''
        )
      ),
      CONSTRAINT CHK_PI_LIVEMODE CHECK (LIVEMODE IN (0, 1))
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- Indexes from migrations 001 and 002
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_PI_CUSTOMER ON STRIPE_PAYMENT_INTENTS(CUSTOMER_ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_PI_STATUS ON STRIPE_PAYMENT_INTENTS(STATUS)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_PI_CREATED ON STRIPE_PAYMENT_INTENTS(CREATED_AT)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_PI_IDEMPOTENCY ON STRIPE_PAYMENT_INTENTS(IDEMPOTENCY_KEY)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_PI_CUSTOMER_CREATED ON STRIPE_PAYMENT_INTENTS(CUSTOMER_ID, CREATED_AT)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
