/**
 * Development seed script.
 *
 * Inserts a deterministic set of rows for local dev. Idempotent: if a row
 * keyed by the seed email/marker exists, the script skips that insert.
 *
 * Uses raw SQL (project preference — see query-constants.ts).
 *
 * Run with:
 *   npm run seed:dev --workspace=apps/api
 */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { AppDataSource } from '../migrations/data-source';

const SEED_EMAIL = 'seed@example.com';
const SEED_MARKER = 'seed:dev';

/** Bcrypt hash of "Password123!" — fine for local dev only. */
const SEED_PASSWORD_HASH =
  '$2b$10$abcdefghijklmnopqrstuuJ8z3R3i7QwR6Vw0LSeedHashForDevOnlyXX';

interface CountRow {
  CNT: number;
}

async function exists(table: string, where: string, params: unknown[]): Promise<boolean> {
  const rows = await AppDataSource.query<CountRow[]>(
    `SELECT COUNT(*) AS "CNT" FROM ${table} WHERE ${where}`,
    params,
  );
  return (rows[0]?.CNT ?? 0) > 0;
}

async function seedUser(): Promise<string> {
  const existing = await AppDataSource.query<Array<{ ID: string }>>(
    `SELECT ID AS "ID" FROM APP_USERS WHERE EMAIL = :1`,
    [SEED_EMAIL],
  );
  if (existing.length > 0) {
    console.log(`[seed] user exists: ${existing[0].ID}`);
    return existing[0].ID;
  }
  const id = randomUUID();
  await AppDataSource.query(
    `INSERT INTO APP_USERS (ID, EMAIL, PASSWORD_HASH, CREATED_AT, UPDATED_AT)
     VALUES (:1, :2, :3, SYSDATE, SYSDATE)`,
    [id, SEED_EMAIL, SEED_PASSWORD_HASH],
  );
  console.log(`[seed] user inserted: ${id}`);
  return id;
}

async function seedCustomer(userId: string): Promise<string> {
  const stripeCustomerId = 'cus_seed_dev_0001';
  if (await exists('STRIPE_CUSTOMERS', 'STRIPE_CUSTOMER_ID = :1', [stripeCustomerId])) {
    const rows = await AppDataSource.query<Array<{ ID: string }>>(
      `SELECT ID AS "ID" FROM STRIPE_CUSTOMERS WHERE STRIPE_CUSTOMER_ID = :1`,
      [stripeCustomerId],
    );
    console.log(`[seed] customer exists: ${rows[0].ID}`);
    return rows[0].ID;
  }
  const id = randomUUID();
  await AppDataSource.query(
    `INSERT INTO STRIPE_CUSTOMERS
       (ID, STRIPE_CUSTOMER_ID, EMAIL, NAME, PHONE, METADATA, IDEMPOTENCY_KEY, USER_ID, IS_DELETED, CREATED_AT, UPDATED_AT)
     VALUES (:1, :2, :3, :4, :5, :6, :7, :8, 0, SYSDATE, SYSDATE)`,
    [
      id,
      stripeCustomerId,
      SEED_EMAIL,
      'Seed Dev User',
      '+15555550000',
      JSON.stringify({ source: SEED_MARKER }),
      `${SEED_MARKER}:customer`,
      userId,
    ],
  );
  console.log(`[seed] customer inserted: ${id}`);
  return id;
}

async function seedPaymentMethod(customerId: string): Promise<string> {
  const stripePmId = 'pm_seed_dev_0001';
  if (await exists('STRIPE_PAYMENT_METHODS', 'STRIPE_PM_ID = :1', [stripePmId])) {
    console.log(`[seed] payment_method exists: ${stripePmId}`);
    return stripePmId;
  }
  const id = randomUUID();
  await AppDataSource.query(
    `INSERT INTO STRIPE_PAYMENT_METHODS
       (ID, STRIPE_PM_ID, TYPE, LAST4, BRAND, EXP_MONTH, EXP_YEAR, FUNDING, COUNTRY, CUSTOMER_ID, IS_DEFAULT, CREATED_AT, UPDATED_AT)
     VALUES (:1, :2, 'card', '4242', 'visa', 12, 2030, 'credit', 'US', :3, 1, SYSDATE, SYSDATE)`,
    [id, stripePmId, customerId],
  );
  console.log(`[seed] payment_method inserted: ${id}`);
  return stripePmId;
}

async function seedPaymentIntent(customerId: string, stripePmId: string): Promise<void> {
  const stripePiId = 'pi_seed_dev_0001';
  if (await exists('STRIPE_PAYMENT_INTENTS', 'STRIPE_PI_ID = :1', [stripePiId])) {
    console.log(`[seed] payment_intent exists: ${stripePiId}`);
    return;
  }
  const id = randomUUID();
  await AppDataSource.query(
    `INSERT INTO STRIPE_PAYMENT_INTENTS
       (ID, STRIPE_PI_ID, AMOUNT, CURRENCY, STATUS, CLIENT_SECRET, CUSTOMER_ID, STRIPE_PM_ID,
        IDEMPOTENCY_KEY, AMOUNT_RECEIVED, LIVEMODE, CREATED_AT, UPDATED_AT)
     VALUES (:1, :2, 2000, 'usd', 'succeeded', :3, :4, :5, :6, 2000, 0, SYSDATE, SYSDATE)`,
    [
      id,
      stripePiId,
      `${stripePiId}_secret_seed`,
      customerId,
      stripePmId,
      `${SEED_MARKER}:payment_intent`,
    ],
  );
  console.log(`[seed] payment_intent inserted: ${id}`);
}

async function seedSetupIntent(customerId: string, stripePmId: string): Promise<void> {
  const stripeSiId = 'seti_seed_dev_0001';
  if (await exists('STRIPE_SETUP_INTENTS', 'STRIPE_SI_ID = :1', [stripeSiId])) {
    console.log(`[seed] setup_intent exists: ${stripeSiId}`);
    return;
  }
  const id = randomUUID();
  await AppDataSource.query(
    `INSERT INTO STRIPE_SETUP_INTENTS
       (ID, STRIPE_SI_ID, STATUS, CLIENT_SECRET, CUSTOMER_ID, STRIPE_PM_ID,
        IDEMPOTENCY_KEY, USAGE, LIVEMODE, CREATED_AT, UPDATED_AT)
     VALUES (:1, :2, 'succeeded', :3, :4, :5, :6, 'off_session', 0, SYSDATE, SYSDATE)`,
    [
      id,
      stripeSiId,
      `${stripeSiId}_secret_seed`,
      customerId,
      stripePmId,
      `${SEED_MARKER}:setup_intent`,
    ],
  );
  console.log(`[seed] setup_intent inserted: ${id}`);
}

async function seedSubscription(customerId: string): Promise<void> {
  const stripeSubId = 'sub_seed_dev_0001';
  if (await exists('STRIPE_SUBSCRIPTIONS', 'STRIPE_SUB_ID = :1', [stripeSubId])) {
    console.log(`[seed] subscription exists: ${stripeSubId}`);
    return;
  }
  const id = randomUUID();
  await AppDataSource.query(
    `INSERT INTO STRIPE_SUBSCRIPTIONS
       (ID, STRIPE_SUB_ID, STATUS, CURRENT_PERIOD_START, CURRENT_PERIOD_END,
        CANCEL_AT_PERIOD_END, STRIPE_PRICE_ID, CUSTOMER_ID, CREATED_AT, UPDATED_AT)
     VALUES (:1, :2, 'active', SYSDATE, SYSDATE + 30, 0, :3, :4, SYSDATE, SYSDATE)`,
    [id, stripeSubId, 'price_seed_dev_0001', customerId],
  );
  console.log(`[seed] subscription inserted: ${id}`);
}

async function run(): Promise<void> {
  await AppDataSource.initialize();
  console.log('[seed] DataSource initialised');
  try {
    const userId = await seedUser();
    const customerId = await seedCustomer(userId);
    const stripePmId = await seedPaymentMethod(customerId);
    await seedPaymentIntent(customerId, stripePmId);
    await seedSetupIntent(customerId, stripePmId);
    await seedSubscription(customerId);
    console.log('[seed] complete');
  } finally {
    await AppDataSource.destroy();
  }
}

run().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
