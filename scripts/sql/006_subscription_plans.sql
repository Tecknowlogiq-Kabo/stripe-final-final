-- =============================================================================
-- Table : SUBSCRIPTION_PLANS
-- Purpose: Catalogue of Stripe prices/plans available for subscription
-- Source : apps/api/src/entities/subscription-plan.entity.ts
--          Migrations 001, 002
-- FK deps: (none — root table)
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE SUBSCRIPTION_PLANS (
      ID                VARCHAR2(36)   DEFAULT SYS_GUID() NOT NULL, -- UUID primary key
      STRIPE_PRICE_ID   VARCHAR2(100)  NOT NULL,                    -- price_xxx from Stripe
      STRIPE_PRODUCT_ID VARCHAR2(100)  NOT NULL,                    -- prod_xxx from Stripe
      NAME              VARCHAR2(255)  NOT NULL,                    -- Human-readable plan name
      DESCRIPTION       VARCHAR2(4000),                             -- Optional plan description
      AMOUNT            NUMBER(15,0)   NOT NULL,                    -- Smallest currency unit
      CURRENCY          VARCHAR2(3)    DEFAULT ''usd'' NOT NULL,    -- ISO 4217 currency code
      INTERVAL_TYPE     VARCHAR2(20)   NOT NULL,                    -- day | week | month | year
      INTERVAL_COUNT    NUMBER(3)      DEFAULT 1 NOT NULL,          -- Intervals between charges
      IS_ACTIVE         NUMBER(1)      DEFAULT 1 NOT NULL,          -- 0=archived, 1=available
      CREATED_AT        TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT        TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT PK_SUBSCRIPTION_PLANS       PRIMARY KEY (ID),
      CONSTRAINT UQ_SUBSCRIPTION_PLANS_PRICE UNIQUE (STRIPE_PRICE_ID),
      CONSTRAINT CHK_PLANS_IS_ACTIVE         CHECK (IS_ACTIVE IN (0, 1)),
      CONSTRAINT CHK_PLANS_INTERVAL          CHECK (INTERVAL_TYPE IN (''day'', ''week'', ''month'', ''year''))
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- Index from migration 002
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_PLANS_IS_ACTIVE ON SUBSCRIPTION_PLANS(IS_ACTIVE)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
