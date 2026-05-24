-- =============================================================================
-- Table : STRIPE_PAYMENT_METHODS
-- Purpose: Tokenised payment methods (cards, bank accounts, etc.) per customer
-- Source : apps/api/src/entities/stripe-payment-method.entity.ts
--          Migrations 001, 004
-- FK deps: STRIPE_CUSTOMERS (CUSTOMER_ID)
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE STRIPE_PAYMENT_METHODS (
      ID                VARCHAR2(36)  DEFAULT SYS_GUID() NOT NULL, -- UUID primary key
      STRIPE_PM_ID      VARCHAR2(100) NOT NULL,                    -- pm_xxx from Stripe
      TYPE              VARCHAR2(50)  NOT NULL,                    -- card, sepa_debit, etc.
      LAST4             VARCHAR2(4),                               -- Last 4 card digits (nullable)
      BRAND             VARCHAR2(50),                              -- visa, mastercard, etc.
      EXP_MONTH         NUMBER(2),                                 -- Card expiry month
      EXP_YEAR          NUMBER(4),                                 -- Card expiry year
      FINGERPRINT       VARCHAR2(100),                             -- Stripe card fingerprint
      DETAILS           CLOB,                                      -- Full card/bank JSON details
      BILLING_DETAILS   CLOB,                                      -- Billing address JSON
      CARD_WALLET_TYPE  VARCHAR2(50),                              -- apple_pay, google_pay, etc.
      COUNTRY           VARCHAR2(2),                               -- ISO 3166-1 alpha-2 country
      FUNDING           VARCHAR2(20),                              -- credit, debit, prepaid
      CUSTOMER_ID       VARCHAR2(36)  NOT NULL,                    -- FK -> STRIPE_CUSTOMERS
      IS_DEFAULT        NUMBER(1)     DEFAULT 0 NOT NULL,          -- Default PM flag (0/1)
      CREATED_AT        TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT        TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT PK_STRIPE_PAYMENT_METHODS     PRIMARY KEY (ID),
      CONSTRAINT UQ_STRIPE_PAYMENT_METHODS_SID UNIQUE (STRIPE_PM_ID),
      CONSTRAINT FK_STRIPE_PM_CUSTOMER         FOREIGN KEY (CUSTOMER_ID)
        REFERENCES STRIPE_CUSTOMERS(ID),
      CONSTRAINT CHK_STRIPE_PM_DEFAULT         CHECK (IS_DEFAULT IN (0, 1))
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- Indexes from migrations 001 and 004
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_PM_CUSTOMER ON STRIPE_PAYMENT_METHODS(CUSTOMER_ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_PM_TYPE_COUNTRY ON STRIPE_PAYMENT_METHODS(TYPE, COUNTRY)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
