# Simplify RTK Query Setup

## Context

The RTK Query migration is complete but over-engineered. There are unnecessary abstraction layers between the API slices and `apiClient`. The setup has 21 files across 5 features when it only needs 12.

## Approach

Remove the middle layers. API slices call `apiClient` directly in `queryFn`. Pages import directly from api-slices. One concern per file.

### What gets removed

| File | Why |
|------|-----|
| `lib/query-fn-helper.ts` | RTKQ handles thrown errors in `queryFn` natively — no wrapper needed |
| `features/*/\*-keys.ts` (4 files) | react-query relic — RTKQ uses tag-based invalidation |
| `features/*/\*.hooks.ts` (5 files) | Pure re-exports — pages import from api-slices directly |
| `features/*/\*.service.ts` (5 files) | Thin wrappers around `apiClient` — inline into api-slice `queryFn` |

### What gets simplified

- **`lib/api-slice.ts`** — Remove duplicated cookie-forwarding (`getServerCookieHeader` is a copy of `apiClient`'s `getCookieHeader`). Use a minimal `baseQuery` since all endpoints use `queryFn` calling `apiClient` anyway.

### What stays unchanged

- `lib/api-client.ts` — Single source of truth for HTTP + auth + idempotency
- `lib/rtk-errors.ts` — Used by 3 pages for error display
- `lib/store.ts` — Fine as-is
- `features/*/\*-api-slice.ts` — Rewritten to call `apiClient` directly
- `features/*/\*.types.ts` — Unchanged
- Server actions (`actions/*.ts`) — Already use `apiClient` directly
- `providers/StoreProvider.tsx` — Fine
- `app/layout.tsx` — Fine

## Files to modify

| File | Action |
|------|--------|
| `lib/query-fn-helper.ts` | **Delete** |
| `lib/api-slice.ts` | **Simplify** — remove duplicated cookie logic, keep minimal |
| `features/auth/auth.service.ts` | **Delete** |
| `features/auth/auth.hooks.ts` | **Delete** |
| `features/auth/auth-api-slice.ts` | **Rewrite** — inline auth fetch logic |
| `features/customers/customers-keys.ts` | **Delete** |
| `features/customers/customers.service.ts` | **Delete** |
| `features/customers/customers.hooks.ts` | **Delete** |
| `features/customers/customers-api-slice.ts` | **Rewrite** — call `apiClient` directly |
| `features/payment-methods/payment-methods-keys.ts` | **Delete** |
| `features/payment-methods/payment-methods.service.ts` | **Delete** |
| `features/payment-methods/payment-methods.hooks.ts` | **Delete** |
| `features/payment-methods/payment-methods-api-slice.ts` | **Rewrite** — call `apiClient` directly |
| `features/payment-intents/payment-intents-keys.ts` | **Delete** |
| `features/payment-intents/payment-intents.service.ts` | **Delete** |
| `features/payment-intents/payment-intents.hooks.ts` | **Delete** |
| `features/payment-intents/payment-intents-api-slice.ts` | **Rewrite** — call `apiClient` directly |
| `features/subscriptions/subscriptions-keys.ts` | **Delete** |
| `features/subscriptions/subscriptions.service.ts` | **Delete** |
| `features/subscriptions/subscriptions.hooks.ts` | **Delete** |
| `features/subscriptions/subscriptions-api-slice.ts` | **Rewrite** — call `apiClient` directly |
| `app/account/page.tsx` | Update imports |
| `app/auth/login/page.tsx` | Update imports |
| `app/auth/register/page.tsx` | Update imports |
| `app/checkout/page.tsx` | Update imports |
| `app/payment-methods/page.tsx` | Update imports |
| `app/payments/page.tsx` | Update imports |
| `app/subscriptions/page.tsx` | Update imports |
| `components/payments/PaymentHistoryPreview.tsx` | Update imports |

## Steps

- [ ] Delete `lib/query-fn-helper.ts`
- [ ] Simplify `lib/api-slice.ts` — remove `getServerCookieHeader`, use minimal `fetchBaseQuery`
- [ ] Delete all `*-keys.ts` files (4)
- [ ] Delete all `*.hooks.ts` files (5)
- [ ] Delete all `*.service.ts` files (5)
- [ ] Rewrite `auth-api-slice.ts` — inline the auth fetch
- [ ] Rewrite `customers-api-slice.ts` — `apiClient` directly in `queryFn`
- [ ] Rewrite `payment-methods-api-slice.ts` — `apiClient` directly in `queryFn`
- [ ] Rewrite `payment-intents-api-slice.ts` — `apiClient` directly in `queryFn`
- [ ] Rewrite `subscriptions-api-slice.ts` — `apiClient` directly in `queryFn`
- [ ] Update 7 page files + 1 component — import from `-api-slice` instead of `.hooks`
- [ ] Build: `cd apps/web && npm run build` — must pass
- [ ] Verify pages render correctly (manual smoke test)

## Verification

```bash
cd apps/web && npm run build
```

Must compile with zero errors.
