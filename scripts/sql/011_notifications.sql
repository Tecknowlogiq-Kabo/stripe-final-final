-- =============================================================================
-- Table : NOTIFICATIONS
-- Purpose: In-app customer notifications with read/unread state
-- Source : apps/api/src/entities/notification.entity.ts
--          Migration 009-billing-records-notifications.ts
-- FK deps: STRIPE_CUSTOMERS (CUSTOMER_ID, ON DELETE CASCADE)
-- =============================================================================

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE NOTIFICATIONS (
      ID          VARCHAR2(36)   DEFAULT SYS_GUID() NOT NULL, -- UUID primary key
      CUSTOMER_ID VARCHAR2(36)   NOT NULL,                    -- FK -> STRIPE_CUSTOMERS
      TYPE        VARCHAR2(50)   NOT NULL,                    -- Notification type key
      TITLE       VARCHAR2(255)  NOT NULL,                    -- Short display title
      MESSAGE     VARCHAR2(4000) NOT NULL,                    -- Full notification body
      IS_READ     NUMBER(1)      DEFAULT 0 NOT NULL,          -- 0=unread, 1=read
      METADATA    CLOB,                                       -- JSON extra context
      CREATED_AT  TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL,
      CONSTRAINT PK_NOTIFICATIONS  PRIMARY KEY (ID),
      CONSTRAINT FK_NOTIF_CUSTOMER FOREIGN KEY (CUSTOMER_ID)
        REFERENCES STRIPE_CUSTOMERS(ID) ON DELETE CASCADE,
      CONSTRAINT CHK_NOTIF_READ CHECK (IS_READ IN (0, 1))
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- Index from migration 009
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX IDX_NOTIF_CUSTOMER_READ ON NOTIFICATIONS(CUSTOMER_ID, IS_READ)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
