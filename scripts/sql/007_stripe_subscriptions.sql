-- =============================================================================
-- Table : STRIPE_SUBSCRIPTIONS
-- Purpose: Active/historical Stripe subscription records per customer
-- Source : apps/api/src/entities/stripe-subscription.entity.ts
--          Migrations 001, 002, 005, 007
-- FK deps: STRIPE_CUSTOMERS (CUSTOMER_ID)
--          SUBSCRIPTION_PLANS (STRIPE_PRICE_ID, ON DELETE SET NULL)
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE STRIPE_SUBSCRIPTIONS (
      ID                   VARCHAR2(36)  DEFAULT SYS_GUID() NOT NULL, -- UUID primary key
      STRIPE_SUB_ID        VARCHAR2(100) NOT NULL,                    -- sub_xxx from Stripe
      STATUS               VARCHAR2(50)  NOT NULL,                    -- Stripe subscription status
      CURRENT_PERIOD_START TIMESTAMP,                                 -- Billing period start
      CURRENT_PERIOD_END   TIMESTAMP,                                 -- Billing period end
      CANCEL_AT_PERIOD_END NUMBER(1)     DEFAULT 0 NOT NULL,          -- Cancels at period end flag
      TRIAL_END            TIMESTAMP,                                 -- Trial end timestamp
      TRIAL_START          TIMESTAMP,                                 -- Trial start timestamp
      STRIPE_PRICE_ID      VARCHAR2(100),                             -- FK -> SUBSCRIPTION_PLANS (nullable)
      DEFAULT_PM_ID        VARCHAR2(100),                             -- Default Stripe PM ID
      CUSTOMER_ID          VARCHAR2(36)  NOT NULL,                    -- FK -> STRIPE_CUSTOMERS
      METADATA             CLOB,                                      -- JSON metadata from Stripe
      CREATED_AT           TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT           TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT PK_STRIPE_SUBSCRIPTIONS  PRIMARY KEY (ID),
      CONSTRAINT UQ_STRIPE_SUB_SID        UNIQUE (STRIPE_SUB_ID),
      CONSTRAINT FK_STRIPE_SUB_CUSTOMER   FOREIGN KEY (CUSTOMER_ID)
        REFERENCES STRIPE_CUSTOMERS(ID),
      CONSTRAINT FK_SUB_PRICE_ID          FOREIGN KEY (STRIPE_PRICE_ID)
        REFERENCES SUBSCRIPTION_PLANS(STRIPE_PRICE_ID) ON DELETE SET NULL,
      CONSTRAINT CHK_SUB_STATUS CHECK (
        STATUS IN (
          ''active'', ''canceled'', ''incomplete'', ''incomplete_expired'',
          ''past_due'', ''paused'', ''trialing'', ''unpaid''
        )
      ),
      CONSTRAINT CHK_SUB_CANCEL_FLAG CHECK (CANCEL_AT_PERIOD_END IN (0, 1))
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- Indexes from migrations 001, 002, and 005
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_SUB_CUSTOMER ON STRIPE_SUBSCRIPTIONS(CUSTOMER_ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_SUB_STATUS ON STRIPE_SUBSCRIPTIONS(STATUS)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_SUB_CUSTOMER_STATUS ON STRIPE_SUBSCRIPTIONS(CUSTOMER_ID, STATUS)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_SUB_PRICE_ID ON STRIPE_SUBSCRIPTIONS(STRIPE_PRICE_ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
