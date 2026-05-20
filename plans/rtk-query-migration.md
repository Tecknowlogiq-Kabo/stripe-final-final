# RTK Query Migration Plan

## Context

The frontend (`apps/web`) currently uses `@tanstack/react-query` v5 for all data fetching with no Redux/RTK at all. The user wants to use RTK Query on the frontend. This is a full migration from react-query hooks to RTK Query APIs, preserving all existing behavior (idempotency keys, cookie auth, token refresh, cache invalidation patterns, global error handling).

## Approach

1. **Install RTK + RTK Query dependencies** (`@reduxjs/toolkit`, `react-redux`)
2. **Create a Redux store** that hosts RTK Query's middleware and the future `apiSlice`
3. **Create a base `apiSlice`** using `createApi` with `fetchBaseQuery` - wrapping the existing `apiClient` behaviors: cookie auth, base URL, credentials, 401 refresh. Because the existing `apiClient` has complex custom logic (server-side cookie forwarding via `next/headers`, silent refresh + retry, auto idempotency keys), we will use `fetchBaseQuery` as the transport but **wrap the existing `apiClient`** via `queryFn` for endpoints that need its logic, or replicate the token refresh pattern using `baseQuery` with `re-auth`.
4. **Keep the existing `apiClient` wrapper** for server actions (which can't use RTK Query directly since they run outside React). The `apiSlice` will call `apiClient` for actual HTTP, or mirror its behaviors.
5. **Migrate each feature** (`auth`, `customers`, `payment-methods`, `payment-intents`, `subscriptions`) from `services.ts` + `hooks.ts` → RTK Query endpoints in a domain-specific `apiSlice` or injected into the base `apiSlice` via `injectEndpoints`.
6. **Replace `QueryProvider`** with Redux `<Provider store={store}>`.
7. **Update all page components** to use RTK Query hooks instead of react-query hooks.
8. **Preserve server actions** (`actions/*.ts`) - they continue using `apiClient` directly since they're server-side.

## Design Decisions (to confirm with user)

- **One `apiSlice` vs multiple**: Use a single `apiSlice` with `injectEndpoints` per feature, or one `apiSlice` per feature?
  - Recommendation: **Single base `apiSlice`** with feature-specific injection via `injectEndpoints` - canonical RTKQ pattern, shared cache/middleware.
- **`fetchBaseQuery` vs custom `baseQuery`**: Since `apiClient` handles cookie forwarding + 401 refresh + idempotency differently for server vs client contexts, we should use a **custom `baseQuery`** that wraps `apiClient` directly (or replicates its logic via `fetchBaseQuery` with `prepareHeaders`). The `apiClient` already works server-side for Server Actions, so wrapping it gives us both environments for free.
- **Auth endpoints**: Auth bypasses `apiClient` (raw fetch to receive Set-Cookie headers). Keep auth endpoints as raw fetch in their service or use `queryFn` with raw fetch. Auth doesn't benefit much from RTKQ caching since it's POST-only mutations.
- **Existing server actions**: Keep them unchanged - they continue using `apiClient` directly. RTK Query hooks will call `apiClient` methods via `queryFn` for queries and mutations.

## Files to modify

| File | Action |
|------|--------|
| `apps/web/package.json` | Add `@reduxjs/toolkit`, `react-redux` |
| `apps/web/src/lib/store.ts` | **New** - Redux store config |
| `apps/web/src/lib/api-slice.ts` | **New** - Base RTKQ `apiSlice` wrapping `apiClient` |
| `apps/web/src/providers/QueryProvider.tsx` | **Replace** with Redux `StoreProvider` (or rename) |
| `apps/web/src/app/layout.tsx` | Swap `QueryProvider` → `StoreProvider` |
| `apps/web/src/features/auth/auth.hooks.ts` | Replace `useMutation` with RTKQ mutation hooks |
| `apps/web/src/features/customers/customers.hooks.ts` | Replace react-query hooks with RTKQ hooks |
| `apps/web/src/features/payment-methods/payment-methods.hooks.ts` | Replace react-query hooks with RTKQ hooks |
| `apps/web/src/features/payment-intents/payment-intents.hooks.ts` | Replace react-query hooks with RTKQ hooks |
| `apps/web/src/features/subscriptions/subscriptions.hooks.ts` | Replace react-query hooks with RTKQ hooks |
| `apps/web/src/app/checkout/page.tsx` | Update imports/hook usage |
| `apps/web/src/app/payment-methods/page.tsx` | Update imports/hook usage |
| `apps/web/src/app/subscriptions/page.tsx` | Update imports/hook usage |
| `apps/web/src/app/payments/page.tsx` | Update imports/hook usage |
| `apps/web/src/app/account/page.tsx` | Update imports/hook usage |
| `apps/web/src/components/payments/PaymentHistoryPreview.tsx` | Update imports/hook usage |
| `apps/web/src/app/auth/login/page.tsx` | Update if using auth hooks |
| `apps/web/src/app/auth/register/page.tsx` | Update if using auth hooks |

**Files to keep unchanged:**
- `lib/api-client.ts` - Preserved for server actions
- `lib/stripe-errors.ts` - Unchanged
- `features/*/\*.service.ts` - Keep for potential direct use
- `features/*/\*.types.ts` - Unchanged
- `actions/*.ts` - Keep using `apiClient` directly

## Reuse

- **`lib/api-client.ts`** - Existing API client with cookie auth, idempotency keys, token refresh. Will be called by RTKQ `queryFn` endpoints.
- **`features/*/\*.types.ts`** - All types remain unchanged, imported by the new RTK Query endpoints.
- **`features/*/\*.service.ts`** - Service classes can be called from `queryFn` endpoints, or their methods can be inlined. Recommended: call service methods from `queryFn` to avoid duplicating logic.
- **`lib/query-client.ts`** - The global error handler (401→redirect) logic can be extracted into a shared utility, or reimplemented in RTK Query middleware.
- **`lib/stripe-errors.ts`** - Unchanged.
- **`middleware.ts`** - Unchanged.

## Steps

### Step 1: Install dependencies
- [ ] Add `@reduxjs/toolkit` and `react-redux` to `apps/web/package.json`
- [ ] Run `npm install`

### Step 2: Create Redux store
- [ ] Create `apps/web/src/lib/store.ts`
  - Configure store with RTK Query middleware from the apiSlice
  - Export `AppStore`, `RootState`, `AppDispatch` types

### Step 3: Create base API slice
- [ ] Create `apps/web/src/lib/api-slice.ts`
  - Use `createApi` with `baseQuery: fetchBaseQuery`
  - Base URL: `process.env.NEXT_PUBLIC_API_URL/api/v1`
  - `credentials: 'include'`
  - Custom `prepareHeaders` for cookie forwarding (client-side only; server-side already done by apiClient)
  - Tag types: `Customer`, `PaymentMethod`, `PaymentIntent`, `Subscription`, `SubscriptionPlan`
  - Empty endpoints initially (injected per feature)
  - Export generated hooks type

### Step 4: Replace QueryProvider with StoreProvider
- [ ] Create or update `apps/web/src/providers/StoreProvider.tsx`
  - `'use client'` wrapper with `<Provider store={store}>`
  - Optionally add devtools
- [ ] Update `apps/web/src/app/layout.tsx` - Swap `QueryProvider` → `StoreProvider`

### Step 5: Migrate auth feature
- [ ] Add auth endpoints to `apiSlice` using `injectEndpoints` (or a separate `authApiSlice`)
- [ ] Auth uses raw fetch (to receive Set-Cookie), so use `queryFn` with `authService` methods
- [ ] Export `useLoginMutation`, `useRegisterMutation`
- [ ] Update `features/auth/auth.hooks.ts` to re-export from RTKQ

### Step 6: Migrate customers feature
- [ ] Inject `getMe`, `getCustomer`, `createCustomer`, `updateCustomer` endpoints
- [ ] Use `queryFn` calling `customersService` methods for each
- [ ] Tag invalidation: `invalidatesTags` / `providesTags` using `Customer` tag type
- [ ] Export `useMyCustomerQuery`, `useCustomerQuery`, `useCreateCustomerMutation`, `useUpdateCustomerMutation`
- [ ] Update `features/customers/customers.hooks.ts` to re-export

### Step 7: Migrate payment-methods feature
- [ ] Inject `listByCustomer`, `attach`, `detach`, `setDefault` endpoints
- [ ] Tag invalidation: `PaymentMethod` tag with customerId
- [ ] Export hooks: `useCustomerPaymentMethodsQuery`, `useAttachPaymentMethodMutation`, etc.
- [ ] Update `features/payment-methods/payment-methods.hooks.ts`

### Step 8: Migrate payment-intents feature
- [ ] Inject `listByCustomer` endpoint (pagination aware)
- [ ] Tag type: `PaymentIntent`
- [ ] Export `useCustomerPaymentIntentsQuery`
- [ ] Update `features/payment-intents/payment-intents.hooks.ts`

### Step 9: Migrate subscriptions feature
- [ ] Inject `listPlans`, `listByCustomer`, `create`, `update`, `cancel` endpoints
- [ ] Tag types: `Subscription`, `SubscriptionPlan`
- [ ] Export hooks: `useSubscriptionPlansQuery`, `useCustomerSubscriptionsQuery`, etc.
- [ ] Update `features/subscriptions/subscriptions.hooks.ts`

### Step 10: Update page components
- [ ] Update all pages to use new RTK Query hooks (names will differ: `useQuery` → `useXxxQuery`, `useMutation` → `useXxxMutation`)
- [ ] Update loading/error states (RTKQ exposes `isLoading`, `isError`, `isFetching`, `refetch` differently)
- [ ] Replace `useQueryClient` / `queryClient.invalidateQueries` with RTKQ's automatic tag invalidation or `apiSlice.util.invalidateTags()`

### Step 11: Global error handling
- [ ] Implement a custom `baseQuery` wrapper that handles 401 errors globally (similar to the `QueryCache`/`MutationCache` `onError` in `query-client.ts`)
- [ ] On 401, redirect to `/auth/login`

### Step 12: Cleanup
- [ ] Remove `@tanstack/react-query`, `@tanstack/react-query-devtools` from dependencies
- [ ] Delete `lib/query-client.ts`
- [ ] Delete old `providers/QueryProvider.tsx` (replaced by StoreProvider)
- [ ] Run `npm uninstall @tanstack/react-query @tanstack/react-query-devtools`
- [ ] Remove any remaining react-query imports

## Verification

1. **Build**: `cd apps/web && npm run build` - Should compile without errors
2. **Lint**: `cd apps/web && npm run lint` - No new warnings
3. **Manual smoke test**:
   - Login/Register flow
   - Create customer profile on Account page
   - Complete a checkout
   - View payment history (with pagination)
   - Add/remove/set-default payment methods
   - View subscriptions and plans
   - Subscription cancel/reactivate
   - Verify token refresh still works (expire auth_token, verify auto-refresh)
4. **Existing tests**: Check if any e2e/playwright tests exist and run them: `cd apps/web && npx playwright test` (if applicable)
