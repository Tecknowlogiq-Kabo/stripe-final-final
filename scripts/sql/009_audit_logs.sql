-- =============================================================================
-- Table : AUDIT_LOGS
-- Purpose: SOC2/GDPR compliance audit trail — immutable, append-only
-- Source : apps/api/src/entities/audit-log.entity.ts
--          Migration 008-create-audit-logs.ts
-- FK deps: (none — intentionally denormalised for forensic integrity)
-- Note   : RETENTION_DATE = CREATED_AT + 90 days, used by purge jobs
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE AUDIT_LOGS (
      ID             VARCHAR2(36)  NOT NULL,           -- UUID primary key (no default; set by app)
      ACTOR_ID       VARCHAR2(36)  NOT NULL,           -- ID of user/service performing the action
      ACTOR_EMAIL    VARCHAR2(255),                    -- Email snapshot at time of action (nullable)
      ACTION         VARCHAR2(100) NOT NULL,           -- Verb, e.g. customer.create
      RESOURCE_TYPE  VARCHAR2(100) NOT NULL,           -- Entity type, e.g. StripeCustomer
      RESOURCE_ID    VARCHAR2(36),                     -- ID of the affected resource (nullable)
      DETAILS        CLOB,                             -- JSON diff / extra context
      IP_ADDRESS     VARCHAR2(45),                     -- IPv4 or IPv6 (max 45 chars)
      USER_AGENT     VARCHAR2(500),                    -- HTTP User-Agent header
      CORRELATION_ID VARCHAR2(36),                     -- Request correlation/trace ID
      STATUS         VARCHAR2(20)  DEFAULT ''success'', -- success | failure
      CREATED_AT     TIMESTAMP     DEFAULT SYSDATE,
      RETENTION_DATE TIMESTAMP     DEFAULT SYSDATE + 90, -- Purge after this date
      CONSTRAINT PK_AUDIT_LOGS PRIMARY KEY (ID)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- Indexes from migration 008
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_AUDIT_ACTOR ON AUDIT_LOGS(ACTOR_ID, CREATED_AT)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_AUDIT_RESOURCE ON AUDIT_LOGS(RESOURCE_TYPE, RESOURCE_ID, CREATED_AT)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_AUDIT_RETENTION ON AUDIT_LOGS(RETENTION_DATE)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
