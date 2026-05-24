# @stripe-integration/web

Next.js 14 (App Router) frontend. Uses `@stripe/stripe-js` +
`@stripe/react-stripe-js` for card collection, and Redux Toolkit Query for
API access.

## Port

`3000` (set in `package.json` -> `dev` script: `next dev -p 3000`).

## Required environment

Client-visible (must be prefixed `NEXT_PUBLIC_`):

```
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY    # pk_test_... or pk_live_...
NEXT_PUBLIC_API_URL                   # e.g. http://localhost:3001/api/v1
```

Server-side (used in route handlers / server actions):

```
API_URL                                # internal URL for the API (SSR fetches)
```

Place these in `apps/web/.env.local`.

## Run

```bash
npm run dev          # next dev -p 3000
npm run build        # next build
npm run start        # next start (production, after build)
npm run lint         # next lint
```

End-to-end tests (Playwright) live in `e2e/`:

```bash
npx playwright test
```
