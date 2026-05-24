-- =============================================================================
-- Table : TRUST_TOKENS
-- Purpose: Short-lived trust/DBS verification tokens with expiry and status
-- Source : apps/api/src/entities/trust-token.entity.ts
-- FK deps: (none — USER_ID is a soft reference, no FK constraint in entity)
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE TRUST_TOKENS (
      ID            VARCHAR2(36)   DEFAULT SYS_GUID() NOT NULL, -- UUID primary key
      TOKEN_HASH    VARCHAR2(128)  NOT NULL,                    -- SHA-256 hash of the raw token
      RESOURCE_TYPE VARCHAR2(50)   NOT NULL,                    -- Type of resource being verified
      RESOURCE_ID   VARCHAR2(100),                              -- ID of the resource (nullable)
      STATUS        VARCHAR2(20)   DEFAULT ''pending'' NOT NULL, -- Token lifecycle status
      EXPIRES_AT    TIMESTAMP      NOT NULL,                    -- Hard expiry; enforce in app
      USER_ID       VARCHAR2(36),                               -- Owning user ID (nullable, no FK)
      CREATED_BY    VARCHAR2(100),                              -- Admin/service that created token
      METADATA      VARCHAR2(4000),                             -- JSON context (not CLOB; < 4000 chars)
      CREATED_AT    TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT    TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT PK_TRUST_TOKENS     PRIMARY KEY (ID),
      CONSTRAINT UQ_TRUST_TOKEN_HASH UNIQUE (TOKEN_HASH),
      CONSTRAINT CHK_TT_STATUS CHECK (
        STATUS IN (''pending'', ''submitted'', ''approved'', ''denied'', ''expired'')
      )
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/
