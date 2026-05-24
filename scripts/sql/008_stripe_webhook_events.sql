-- =============================================================================
-- Table : STRIPE_WEBHOOK_EVENTS
-- Purpose: Deduplication log for incoming Stripe webhook events
-- Source : apps/api/src/entities/stripe-webhook-event.entity.ts
--          Migrations 001, 002, 005
-- FK deps: (none — standalone event store)
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE STRIPE_WEBHOOK_EVENTS (
      ID              VARCHAR2(36)   DEFAULT SYS_GUID() NOT NULL, -- UUID primary key
      STRIPE_EVENT_ID VARCHAR2(100)  NOT NULL,                    -- evt_xxx from Stripe
      EVENT_TYPE      VARCHAR2(100)  NOT NULL,                    -- e.g. payment_intent.succeeded
      PAYLOAD         CLOB           NOT NULL,                    -- Full JSON event payload
      STATUS          VARCHAR2(20)   DEFAULT ''pending'' NOT NULL, -- Processing status
      ERROR_MESSAGE   VARCHAR2(4000),                             -- Error text on failure
      RETRY_COUNT     NUMBER(3)      DEFAULT 0 NOT NULL,          -- Number of retry attempts
      PROCESSED_AT    TIMESTAMP,                                  -- Timestamp of successful processing
      CREATED_AT      TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT      TIMESTAMP      DEFAULT SYSTIMESTAMP,        -- Added in migration 002
      CONSTRAINT PK_STRIPE_WEBHOOK_EVENTS   PRIMARY KEY (ID),
      CONSTRAINT UQ_STRIPE_WEBHOOK_EVENT_ID UNIQUE (STRIPE_EVENT_ID),
      CONSTRAINT CHK_WH_STATUS CHECK (
        STATUS IN (''pending'', ''processed'', ''failed'', ''skipped'')
      )
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- Indexes from migrations 001, 002, and 005
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_WH_TYPE ON STRIPE_WEBHOOK_EVENTS(EVENT_TYPE)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_WH_STATUS ON STRIPE_WEBHOOK_EVENTS(STATUS)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_WH_CREATED ON STRIPE_WEBHOOK_EVENTS(CREATED_AT)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_WH_EVENT_TYPE_STATUS ON STRIPE_WEBHOOK_EVENTS(EVENT_TYPE, STATUS)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_WH_RETRY ON STRIPE_WEBHOOK_EVENTS(STATUS, RETRY_COUNT, CREATED_AT)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
