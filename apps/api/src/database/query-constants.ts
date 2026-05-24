/** Centralised SQL SELECT column lists for raw Oracle queries. */

export const CUSTOMER_SELECT = `ID AS "id", STRIPE_CUSTOMER_ID AS "stripeCustomerId", EMAIL AS "email", NAME AS "name", PHONE AS "phone", METADATA AS "metadata", IDEMPOTENCY_KEY AS "idempotencyKey", USER_ID AS "userId", IS_DELETED AS "isDeleted", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

export const PM_SELECT = `ID AS "id", STRIPE_PM_ID AS "stripePaymentMethodId", TYPE AS "type", LAST4 AS "last4", BRAND AS "brand", EXP_MONTH AS "expMonth", EXP_YEAR AS "expYear", FINGERPRINT AS "fingerprint", DETAILS AS "details", BILLING_DETAILS AS "billingDetails", CARD_WALLET_TYPE AS "cardWalletType", COUNTRY AS "country", FUNDING AS "funding", CUSTOMER_ID AS "customerId", IS_DEFAULT AS "isDefault", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

export const PI_SELECT = `ID AS "id", STRIPE_PI_ID AS "stripePaymentIntentId", AMOUNT AS "amount", CURRENCY AS "currency", STATUS AS "status", CLIENT_SECRET AS "clientSecret", CUSTOMER_ID AS "customerId", STRIPE_PM_ID AS "stripePaymentMethodId", IDEMPOTENCY_KEY AS "idempotencyKey", METADATA AS "metadata", DESCRIPTION AS "description", ERROR_CODE AS "errorCode", ERROR_DECLINE_CODE AS "errorDeclineCode", ERROR_MESSAGE AS "errorMessage", SETUP_FUTURE_USAGE AS "setupFutureUsage", NEXT_ACTION AS "nextAction", PAYMENT_METHOD_TYPES AS "paymentMethodTypes", AMOUNT_RECEIVED AS "amountReceived", AMOUNT_CAPTURABLE AS "amountCapturable", RECEIPT_EMAIL AS "receiptEmail", STATEMENT_DESCRIPTOR AS "statementDescriptor", LIVEMODE AS "livemode", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

export const SI_SELECT = `ID AS "id", STRIPE_SI_ID AS "stripeSetupIntentId", STATUS AS "status", CLIENT_SECRET AS "clientSecret", CUSTOMER_ID AS "customerId", STRIPE_PM_ID AS "stripePaymentMethodId", IDEMPOTENCY_KEY AS "idempotencyKey", METADATA AS "metadata", DESCRIPTION AS "description", PAYMENT_METHOD_TYPES AS "paymentMethodTypes", USAGE AS "usage", LAST_SETUP_ERROR AS "lastSetupError", NEXT_ACTION AS "nextAction", LIVEMODE AS "livemode", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

export const SUB_SELECT = `ID AS "id", STRIPE_SUB_ID AS "stripeSubscriptionId", STATUS AS "status", CURRENT_PERIOD_START AS "currentPeriodStart", CURRENT_PERIOD_END AS "currentPeriodEnd", CANCEL_AT_PERIOD_END AS "cancelAtPeriodEnd", TRIAL_END AS "trialEnd", TRIAL_START AS "trialStart", STRIPE_PRICE_ID AS "stripePriceId", DEFAULT_PM_ID AS "defaultPaymentMethodId", CUSTOMER_ID AS "customerId", METADATA AS "metadata", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

export const PLAN_SELECT = `ID AS "id", STRIPE_PRICE_ID AS "stripePriceId", STRIPE_PRODUCT_ID AS "stripeProductId", NAME AS "name", DESCRIPTION AS "description", AMOUNT AS "amount", CURRENCY AS "currency", INTERVAL_TYPE AS "interval", INTERVAL_COUNT AS "intervalCount", IS_ACTIVE AS "isActive", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

export const WEBHOOK_SELECT = `ID AS "id", STRIPE_EVENT_ID AS "stripeEventId", EVENT_TYPE AS "eventType", PAYLOAD AS "payload", STATUS AS "status", ERROR_MESSAGE AS "errorMessage", RETRY_COUNT AS "retryCount", PROCESSED_AT AS "processedAt", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

export const USER_SELECT = `ID AS "id", EMAIL AS "email", PASSWORD_HASH AS "passwordHash", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

export const BILLING_RECORD_SELECT = `ID AS "id", SUBSCRIPTION_ID AS "subscriptionId", CHARGE_AMOUNT AS "chargeAmount", CURRENCY AS "currency", STATUS AS "status", PERIOD_DATE AS "periodDate", LOCKED_AT AS "lockedAt", CHARGED_AT AS "chargedAt", STRIPE_PAYMENT_INTENT_ID AS "stripePaymentIntentId", FAILURE_MESSAGE AS "failureMessage", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

export const NOTIFICATION_SELECT = `ID AS "id", CUSTOMER_ID AS "customerId", TYPE AS "type", TITLE AS "title", MESSAGE AS "message", IS_READ AS "isRead", METADATA AS "metadata", CREATED_AT AS "createdAt"`;
