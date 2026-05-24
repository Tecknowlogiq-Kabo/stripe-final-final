-- =============================================================================
-- Table : TRUST_TOKENS (v2 — add S3 safety-net columns)
-- Purpose: Adds BRANCH_ID, S3_COLLECTED_AT, RETRY_COUNT, RETRY_BRANCH_ID
--          and a composite index used by the 30-minute S3 safety-net cron job.
-- Source : apps/api/src/database/migrations/010-trustid-enhancements.ts
-- Prereq : 012_trust_tokens.sql must have run first
-- =============================================================================

-- Add new columns (idempotent: ignore ORA-01430 "column already exists")
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE TRUST_TOKENS ADD (
    BRANCH_ID       VARCHAR2(100),
    S3_COLLECTED_AT TIMESTAMP,
    RETRY_COUNT     NUMBER DEFAULT 0,
    RETRY_BRANCH_ID VARCHAR2(100)
  )';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -1430 THEN RAISE; END IF;
END;
/

-- Create composite index for the safety-net query (idempotent: ignore ORA-01408 "index already exists")
BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX IDX_TT_S3_COLLECTED ON TRUST_TOKENS (STATUS, S3_COLLECTED_AT, UPDATED_AT)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -1408 THEN RAISE; END IF;
END;
/
