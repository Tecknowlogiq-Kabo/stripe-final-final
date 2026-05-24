-- =============================================================================
-- Table : BILLING_RECORDS
-- Purpose: Per-subscription billing cycle records with lock/charge lifecycle
-- Source : apps/api/src/entities/billing-record.entity.ts
--          Migration 009-billing-records-notifications.ts
-- FK deps: STRIPE_SUBSCRIPTIONS (SUBSCRIPTION_ID, ON DELETE CASCADE)
-- Note   : PERIOD_DATE stored as TIMESTAMP (entity uses timestamp type)
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE BILLING_RECORDS (
      ID                       VARCHAR2(36)   DEFAULT SYS_GUID() NOT NULL, -- UUID primary key
      SUBSCRIPTION_ID          VARCHAR2(36)   NOT NULL,                    -- FK -> STRIPE_SUBSCRIPTIONS
      CHARGE_AMOUNT            NUMBER(15,0)   NOT NULL,                    -- Amount in smallest currency unit
      CURRENCY                 VARCHAR2(3)    DEFAULT ''usd'' NOT NULL,    -- ISO 4217 currency code
      STATUS                   VARCHAR2(20)   DEFAULT ''pending'' NOT NULL, -- Billing lifecycle status
      PERIOD_DATE              TIMESTAMP      NOT NULL,                    -- Billing period date
      LOCKED_AT                TIMESTAMP,                                  -- When record was locked for charge
      CHARGED_AT               TIMESTAMP,                                  -- When charge was processed
      STRIPE_PAYMENT_INTENT_ID VARCHAR2(100),                             -- pi_xxx if charge succeeded
      FAILURE_MESSAGE          VARCHAR2(4000),                            -- Error on failed charge
      CREATED_AT               TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UPDATED_AT               TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL,
      CONSTRAINT PK_BILLING_RECORDS PRIMARY KEY (ID),
      CONSTRAINT FK_BR_SUBSCRIPTION FOREIGN KEY (SUBSCRIPTION_ID)
        REFERENCES STRIPE_SUBSCRIPTIONS(ID) ON DELETE CASCADE,
      CONSTRAINT CHK_BR_STATUS CHECK (
        STATUS IN (''pending'', ''locked'', ''charged'', ''failed'')
      )
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- Indexes from migration 009
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_BR_SUB_PERIOD ON BILLING_RECORDS(SUBSCRIPTION_ID, PERIOD_DATE)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_BR_STATUS ON BILLING_RECORDS(STATUS)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
