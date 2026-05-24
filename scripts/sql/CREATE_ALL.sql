-- =============================================================================
-- CREATE_ALL.sql
-- Project : stripe-final-final (NestJS + Oracle XE)
-- Purpose : Create all 12 application tables in FK dependency order.
-- Generated: 2026-05-24
--
-- Usage (SQL*Plus / SQLcl, run from the scripts/sql/ directory):
--
--   cd scripts/sql
--   sqlplus <user>/<pass>@<dsn> @CREATE_ALL.sql
--
-- Each individual script is idempotent: re-running will skip tables that
-- already exist (ORA-00955 is suppressed). Indexes are similarly guarded.
--
-- FK dependency order (parent before child):
--   1.  APP_USERS               — no dependencies
--   2.  STRIPE_CUSTOMERS        — -> APP_USERS
--   3.  STRIPE_PAYMENT_METHODS  — -> STRIPE_CUSTOMERS
--   4.  STRIPE_PAYMENT_INTENTS  — -> STRIPE_CUSTOMERS
--   5.  STRIPE_SETUP_INTENTS    — -> STRIPE_CUSTOMERS
--   6.  SUBSCRIPTION_PLANS      — no dependencies
--   7.  STRIPE_SUBSCRIPTIONS    — -> STRIPE_CUSTOMERS, -> SUBSCRIPTION_PLANS
--   8.  STRIPE_WEBHOOK_EVENTS   — no dependencies
--   9.  AUDIT_LOGS              — no dependencies
--   10. BILLING_RECORDS         — -> STRIPE_SUBSCRIPTIONS
--   11. NOTIFICATIONS           — -> STRIPE_CUSTOMERS
--   12. TRUST_TOKENS            — no dependencies
-- =============================================================================

@@001_app_users.sql
@@002_stripe_customers.sql
@@003_stripe_payment_methods.sql
@@004_stripe_payment_intents.sql
@@005_stripe_setup_intents.sql
@@006_subscription_plans.sql
@@007_stripe_subscriptions.sql
@@008_stripe_webhook_events.sql
@@009_audit_logs.sql
@@010_billing_records.sql
@@011_notifications.sql
@@012_trust_tokens.sql

PROMPT
PROMPT ============================================================
PROMPT All 12 tables created (or already existed). Schema is ready.
PROMPT ============================================================
