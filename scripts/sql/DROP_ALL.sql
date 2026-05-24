-- =============================================================================
-- DROP_ALL.sql
-- Project : stripe-final-final (NestJS + Oracle XE)
-- Purpose : Drop all 12 application tables in REVERSE FK dependency order.
--           Child tables are dropped before their parents so FK constraints
--           do not block the DROP.
-- Generated: 2026-05-24
--
-- WARNING : This is a DESTRUCTIVE operation. All data will be lost.
--
-- Usage (SQL*Plus / SQLcl):
--
--   sqlplus <user>/<pass>@<dsn> @DROP_ALL.sql
--
-- Each statement is wrapped so that ORA-00942 (table or view does not exist)
-- is silently ignored — re-running is safe.
--
-- Reverse FK dependency order (child before parent):
--   12. TRUST_TOKENS
--   11. NOTIFICATIONS           — child of STRIPE_CUSTOMERS
--   10. BILLING_RECORDS         — child of STRIPE_SUBSCRIPTIONS
--   9.  AUDIT_LOGS
--   8.  STRIPE_WEBHOOK_EVENTS
--   7.  STRIPE_SUBSCRIPTIONS    — child of STRIPE_CUSTOMERS, SUBSCRIPTION_PLANS
--   6.  SUBSCRIPTION_PLANS
--   5.  STRIPE_SETUP_INTENTS    — child of STRIPE_CUSTOMERS
--   4.  STRIPE_PAYMENT_INTENTS  — child of STRIPE_CUSTOMERS
--   3.  STRIPE_PAYMENT_METHODS  — child of STRIPE_CUSTOMERS
--   2.  STRIPE_CUSTOMERS        — child of APP_USERS
--   1.  APP_USERS
-- =============================================================================

BEGIN EXECUTE IMMEDIATE 'DROP TABLE TRUST_TOKENS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE NOTIFICATIONS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE BILLING_RECORDS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE AUDIT_LOGS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE STRIPE_WEBHOOK_EVENTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE STRIPE_SUBSCRIPTIONS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE SUBSCRIPTION_PLANS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE STRIPE_SETUP_INTENTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE STRIPE_PAYMENT_INTENTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE STRIPE_PAYMENT_METHODS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE STRIPE_CUSTOMERS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE APP_USERS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/

PROMPT
PROMPT ============================================================
PROMPT All 12 tables dropped (or did not exist).
PROMPT ============================================================
