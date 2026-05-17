# Security Best Practices Report

**Date:** 2026-05-17
**Scope:** Full-stack Stripe integration (NestJS API + Next.js frontend)

## Executive Summary

The codebase has solid security fundamentals: parameterized SQL, global JWT auth, input validation, rate limiting, webhook signature verification, and strong security headers. Four issues found and fixed — an open redirect, a defense-in-depth SQL interpolation concern, unsanitized error response paths, and missing CSP directives. No critical vulnerabilities.

---

## Findings

### HIGH Severity

#### H-1: Open Redirect on Login and Register Pages (FIXED)

- **Location:** `apps/web/src/app/auth/login/page.tsx:19`, `apps/web/src/app/auth/register/page.tsx:19`
- **Evidence:** `router.push(new URLSearchParams(window.location.search).get('redirect') ?? '/')` — accepts arbitrary URLs from query params without validation.
- **Impact:** Attacker crafts `/auth/login?redirect=https://evil.com` to phish users after authentication.
- **Fix applied:** Validate redirect is a relative path: `raw.startsWith('/') && !raw.startsWith('//')`.

#### H-2: SQL Sort Order String Interpolation (FIXED)

- **Location:** `apps/api/src/payment-intents/payment-intents.repository.ts:95`
- **Evidence:** `ORDER BY ${sortCol} ${filters.sortOrder}` — sort direction interpolated directly into SQL.
- **Impact:** Protected by DTO `@IsIn(['ASC', 'DESC'])` validation, but vulnerable if validation is ever bypassed.
- **Fix applied:** Added safelist in repository: `const sortDir = filters.sortOrder === 'ASC' ? 'ASC' : 'DESC'`.

### MEDIUM Severity

#### M-1: Error Response Includes Unsanitized Request Path (FIXED)

- **Location:** `apps/api/src/common/filters/all-exceptions.filter.ts:48`
- **Evidence:** `path: request.url` returned to client without sanitization. Query strings may contain sensitive data.
- **Fix applied:** Changed to `path: sanitizePath(request.url)`.

#### M-2: CSP Uses `unsafe-inline` for Scripts (ACCEPTED RISK)

- **Location:** `apps/web/next.config.mjs` CSP header
- **Evidence:** `script-src 'self' 'unsafe-inline' https://js.stripe.com`
- **Impact:** Weakens CSP XSS protection. Known limitation of Next.js App Router.
- **Status:** No fix available without breaking Next.js. Accepted trade-off.

### LOW Severity

#### L-1: Weak Password Complexity Rules (NOT FIXED - INFORMATIONAL)

- **Location:** `apps/api/src/auth/dto/auth.dto.ts:7-9`
- **Evidence:** Only `@MinLength(8)` enforced.
- **Note:** NIST 800-63B recommends length over complexity. Current 8-char minimum is acceptable.

#### L-2: Missing CSP Directives (FIXED)

- **Location:** `apps/web/next.config.mjs` CSP header
- **Fix applied:** Added `base-uri 'self'` and `form-action 'self'` directives.

---

## False Positives Investigated

| Claim | Verdict | Reason |
|-------|---------|--------|
| Committed .env files | False positive | `git ls-files` confirms neither tracked |
| Missing CSRF protection | False positive | SameSite strict cookies + server action origin restrictions |
| Reporting endpoints unprotected | False positive | Global JwtAuthGuard (APP_GUARD) covers all non-@Public() routes |

---

## Positive Findings (Already Implemented)

- Parameterized SQL queries (`:1, :2` bindings) across all repositories
- Global JWT auth guard with `@Public()` escape hatch
- Global ValidationPipe with whitelist + forbidNonWhitelisted
- Rate limiting: 5/min auth, 20/min payments, 100/min default
- Bcrypt with 12 salt rounds
- Webhook signature verification guard
- httpOnly + SameSite strict cookies for auth tokens
- Refresh token rotation on use
- Security headers: HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy
- Request body size limit (100kb)
- Helmet middleware
- No `dangerouslySetInnerHTML` usage
- UUID v4 for all resource IDs
- Idempotency key support
- Stripe CSP allowlisting
