# Observability Security & Compliance Audit

**Repository:** Stripe Payments NestJS Monorepo  
**Auditor:** Security & Governance Architect (AI)  
**Date:** 2026-05-19  
**Scope:** Logging, metrics, exception handling, audit trail, Sentry integration  
**Frameworks:** PCI-DSS v4.0, SOC2 (CC6.x), GDPR Art. 32, ISO 27001 A.12.4

---

## Table of Contents

1. [Finding #1: `sanitizeFields` Is Dead Code (CRITICAL)](#finding-1-sanitizefields-is-dead-code)
2. [Finding #2: Pino Redact Paths Miss PCI-Critical Fields (HIGH)](#finding-2-pino-redact-paths-miss-pci-critical-fields)
3. [Finding #3: Request Bodies Are Not Redacted (HIGH)](#finding-3-request-bodies-are-not-redacted)
4. [Finding #4: Sentry Captures Raw Stack Traces Without PII Scrubbing (HIGH)](#finding-4-sentry-captures-raw-stack-traces-without-pii-scrubbing)
5. [Finding #5: Metrics Endpoint Requires JWT but No Explicit Access Control (MEDIUM)](#finding-5-metrics-endpoint-requires-jwt-but-no-explicit-access-control)
6. [Finding #6: AuditInterceptor — Opt-In, No Diffs, No Purge Job (MEDIUM)](#finding-6-auditinterceptor--opt-in-no-diffs-no-purge-job)
7. [Finding #7: Log Retention Insufficient for PCI-DSS 1-Year Requirement (HIGH)](#finding-7-log-retention-insufficient-for-pci-dss-1-year-requirement)
8. [Finding #8: Log Files Not Encrypted at Rest (MEDIUM)](#finding-8-log-files-not-encrypted-at-rest)
9. [Finding #9: Correlation ID Header Injection (LOW)](#finding-9-correlation-id-header-injection)
10. [Finding #10: Webhook Raw Body Could Leak Through Indirect Paths (MEDIUM)](#finding-10-webhook-raw-body-could-leak-through-indirect-paths)
11. [Finding #11: `sanitizePath` Strips Query Params But Path Itself May Contain Secrets (LOW)](#finding-11-sanitizepath-strips-query-params-but-path-itself-may-contain-secrets)
12. [Finding #12: No Log Integrity Protection (MEDIUM)](#finding-12-no-log-integrity-protection)

---

## Finding #1: `sanitizeFields` Is Dead Code

| Attribute | Detail |
|-----------|--------|
| **Severity** | **CRITICAL** (CVSS-equivalent: 8.6) |
| **File(s)** | `apps/api/src/logging/sanitize.ts` |
| **Type** | Architectural gap / dead code |

### Evidence

`sanitizeFields()` and `maskEmail()` are exported from `sanitize.ts` but **never imported anywhere in the codebase**. A grep of the entire `src/` tree confirms zero import references. The only function from this module that is actually used is `sanitizePath()`, which is called in `AllExceptionsFilter`.

```typescript
// sanitize.ts — defined but never called
export function sanitizeFields(obj: Record<string, unknown>): Record<string, unknown> { ... }
export function maskEmail(email: string): string { ... }
```

The pinoHttp configuration in `logger.module.ts` uses pino's **built-in** `redact` mechanism instead. These two mechanisms are completely disconnected.

### Why It's Critical

The developers almost certainly **believe** field-level redaction is happening because the sanitizer module exists. In reality, there is no runtime sanitization of log objects beyond pino's five redact paths (see Finding #2). Any code that calls `this.logger.log({ body: someObject })` will write the raw object to stdout/files/Sentry without any field-level redaction.

### Even If It Were Active, the SENSITIVE Set Is Insufficient

The SENSITIVE set (`sanitize.ts`, line 3-9) contains:
```
password, token, authorization, ssn, creditcard, secret,
apikey, api_key, refreshtoken, refresh_token,
stripesecretkey, stripe_secret_key, webhooksecret, webhook_secret,
jwtsecret, jwt_secret, databaseurl, database_url,
redisurl, redis_url, privatekey, private_key
```

**Missing PCI-DSS and PII fields:**
| Missing Field | PCI-DSS Relevance | Variants Not Covered |
|---|---|---|
| Card number / PAN | Req. 3.4 | `card_number`, `cardNumber`, `number`, `pan`, `cc`, `cc_number` |
| CVC / CVV | Req. 3.2 (prohibited from storage) | `cvc`, `cvv`, `cvv2`, `security_code`, `cvc_check` |
| Expiry date | Req. 3.4 | `exp`, `expiry`, `expiration`, `exp_month`, `exp_year`, `card.exp_month` |
| Bank account | ACH/routing | `bank_account`, `routing_number`, `account_number`, `iban`, `bic`, `sort_code` |
| Customer PII | GDPR Art. 4(1) | `email`, `phone`, `address`, `name`, `first_name`, `last_name`, `dob`, `date_of_birth`, `tax_id`, `ip`, `ip_address` |
| Stripe tokens | PCI handling | `source`, `payment_method`, `payment_method_id`, `client_secret` |

### Array Bypass Vector

The function explicitly skips arrays:
```typescript
} else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
```

If sensitive data appears inside an array (e.g., `line_items: [{ price: '...', metadata: { card_number: '...' } }]`), it passes through unredacted.

### Recommendations

1. **Immediately wire `sanitizeFields` into the pino serializers** as a `req.body` and `res.body` serializer, OR expand the pino `redact.paths` to use wildcard patterns.
2. Expand the SENSITIVE set to include all fields listed above.
3. Add array traversal to `sanitizeFields`:
   ```typescript
   } else if (Array.isArray(v)) {
     out[k] = v.map(item =>
       item !== null && typeof item === 'object' ? sanitizeFields(item) : item
     );
   }
   ```
4. Add a unit test that verifies known sensitive fields are redacted in pino output.

---

## Finding #2: Pino Redact Paths Miss PCI-Critical Fields

| Attribute | Detail |
|-----------|--------|
| **Severity** | **HIGH** (CVSS-equivalent: 7.5) |
| **File(s)** | `apps/api/src/logging/logger.module.ts` (lines 26-33) |
| **Type** | Configuration gap |

### Current Redaction Configuration

```typescript
redact: {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["stripe-signature"]',
    'req.query.email',
    'req.query.token',
  ],
  censor: '[REDACTED]',
},
```

### Gaps

| Category | Missing Path | Risk |
|---|---|---|
| Headers | `req.headers["x-api-key"]` | API key leakage |
| Headers | `req.headers["idempotency-key"]` | Low, but can leak client-side UUIDs |
| Query params | `req.query.card`, `req.query.number`, `req.query.cvv` | Direct PAN exposure in URL |
| Query params | `req.query.source`, `req.query.client_secret` | Stripe token leakage |
| Query params | `req.query.email`, `req.query.token` are covered, but `req.query.phone`, `req.query.name` are not | PII leakage |
| **Request body** | `req.body` — **COMPLETELY UNREDACTED** | See Finding #3 |
| **Response body** | `res.body` — **COMPLETELY UNREDACTED** | See Finding #3 |
| Nested objects | No wildcards (e.g., `req.body.*.card`) | Deeply nested PAN exposure |

### Pino Redact Limitation

Pino's `redact` paths use `fast-redact`, which supports `*` wildcards but **not** recursive wildcards (`**`). You cannot write a single path to cover all deeply nested occurrences of `card_number`. This is why a custom serializer function (wrapping `sanitizeFields`) is necessary for deep object scanning.

### Recommendations

1. Add redact paths for `req.headers["x-api-key"]`, `req.query.phone`, `req.query.name`, `req.query.source`, `req.query.client_secret`, and all PCI-relevant query params.
2. **Do not rely solely on pino redact paths.** Wire `sanitizeFields` into the request/response serializers (see Finding #1).
3. Consider using `pino-noir` plugin or a custom serialization layer that deep-scans payloads before they reach pino.

---

## Finding #3: Request Bodies Are Not Redacted

| Attribute | Detail |
|-----------|--------|
| **Severity** | **HIGH** (CVSS-equivalent: 8.2) |
| **File(s)** | `apps/api/src/logging/logger.module.ts` (lines 54-62) |
| **Type** | Architectural gap |

### Evidence

The pinoHttp serializers only capture four fields for requests:

```typescript
serializers: {
  req(req: IncomingMessage) {
    return {
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.socket?.remoteAddress,
    };
  },
},
```

**This is excellent for the default serializer** — it explicitly avoids logging `req.body`. However:

1. **There is no `res` serializer defined.** pino's default response serializer logs response payloads. If `autoLogging: true` is enabled and the response contains customer data (e.g., a GET /customers/:id endpoint returning name, email, address), it gets logged in full.

2. **Any explicit logger call with request data bypasses the serializer:**
   ```typescript
   // Hypothetical in a controller or service:
   this.logger.info({ body: req.body }, 'Processing payment');
   // ☠️ Full card data in logs
   ```

3. **The StripeExceptionFilter does not sanitize the Stripe error object.** While it carefully extracts only `requestId`, `type`, `code`, and `decline_code`, the `...(exception)` spread pattern is not used on the full error object. However, the `exception.message` is returned to the user in one case (line 87 of stripe-exception.filter.ts):
   ```typescript
   userMessage = exception.message;  // StripeCardError path
   ```
   If Stripe's error message ever includes even a masked PAN (which Stripe sometimes does with `****1234` format), it leaks through to logs via the NestJS Logger.

### Recommendations

1. Add a `res` serializer that strips the body or applies `sanitizeFields`:
   ```typescript
   res(res: ServerResponse & { body?: unknown }) {
     return { statusCode: res.statusCode };
   },
   ```
2. Create a lint rule or convention that prohibits passing raw `req.body` to any logger call.
3. Use a structured logging wrapper that auto-sanitizes before calling pino.
4. In `StripeExceptionFilter`, never expose `exception.message` to the user for `StripeCardError`. Always use a generic message and log the raw message internally to an encrypted audit channel.

---

## Finding #4: Sentry Captures Raw Stack Traces Without PII Scrubbing

| Attribute | Detail |
|-----------|--------|
| **Severity** | **HIGH** (CVSS-equivalent: 7.8) |
| **File(s)** | `apps/api/src/main.ts` (lines 33-41), `apps/api/src/common/filters/all-exceptions.filter.ts` (lines 48-55) |
| **Type** | Configuration gap |

### Evidence

**Sentry init has no PII protection:**
```typescript
Sentry.init({
  dsn: sentryDsn,
  environment: nodeEnv,
  tracesSampleRate: nodeEnv === 'production' ? 0.1 : 1.0,
});
```

Missing:
- `beforeSend` — no PII stripping before events reach Sentry's servers
- `beforeBreadcrumb` — no breadcrumb filtering
- `denyUrls` — no exclusion of health/metrics endpoints
- `sendDefaultPii: false` is the default, but this only controls IP/user data, not custom event data

**Exception filter logs raw `exception.stack` to pino:**
```typescript
this.logger.error({
  message: 'Unhandled exception',
  error: exception instanceof Error ? exception.message : String(exception),
  stack: exception instanceof Error ? exception.stack : undefined,
  correlationId: request.correlationId,
  path: sanitizePath(request.url),
});
```

If `Sentry.init` is active, pino's transport likely forwards error-level logs to Sentry (via `@sentry/node` integration, or a custom transport). Stack traces contain:
- Function arguments (which may include PAN, PII)
- File paths revealing infrastructure details
- Closure variables with sensitive data

**Sentry + OpenTelemetry interplay:** `main.ts` imports `./instrumentation.ts` which sets up OpenTelemetry auto-instrumentation. If Sentry's OTel integration is active, it captures span attributes that may contain request parameters, headers, and response bodies — none of which are scrubbed.

### Recommendation

1. Add `beforeSend` hook to strip PII:
   ```typescript
   Sentry.init({
     dsn: sentryDsn,
     environment: nodeEnv,
     tracesSampleRate: nodeEnv === 'production' ? 0.1 : 1.0,
     beforeSend(event) {
       // Strip sensitive headers from request data
       delete event.request?.headers?.['authorization'];
       delete event.request?.headers?.['cookie'];
       delete event.request?.headers?.['stripe-signature'];
       delete event.request?.data;  // Remove request body entirely
       // Strip stack frame local variables
       if (event.exception?.values) {
         for (const v of event.exception.values) {
           if (v.stacktrace?.frames) {
             for (const f of v.stacktrace.frames) {
               delete f.vars;
             }
           }
         }
       }
       return event;
     },
     denyUrls: [/\/api\/v1\/health/, /\/api\/v1\/metrics/],
   });
   ```
2. In `AllExceptionsFilter`, do NOT log `exception.stack` to pino when Sentry is active. Instead, rely on Sentry's SDK to capture the error directly via `Sentry.captureException(exception)` and let the `beforeSend` hook sanitize it.
3. Configure OTel span processors to strip sensitive attributes:
   ```typescript
   span.setAttribute('sensitive', true); // custom logic to flag spans for filtering
   ```

---

## Finding #5: Metrics Endpoint Requires JWT but No Explicit Access Control

| Attribute | Detail |
|-----------|--------|
| **Severity** | **MEDIUM** (CVSS-equivalent: 5.3) |
| **File(s)** | `apps/api/src/metrics/metrics.controller.ts`, `apps/api/src/app.module.ts` |
| **Type** | Access control gap / operational risk |

### Evidence

`MetricsController` does **not** use the `@Public()` decorator:
```typescript
@Controller('metrics')
export class MetricsController {
  @Get()
  async getMetrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', 'text/plain');
    res.send(await this.metricsService.getMetrics());
  }
}
```

Since `JwtAuthGuard` is registered as a global `APP_GUARD` in `AppModule`:
```typescript
{ provide: APP_GUARD, useClass: JwtAuthGuard },
```

The `/api/v1/metrics` endpoint is protected by JWT authentication. This prevents public access, **but**:

1. **Prometheus can't provide JWTs.** Standard Prometheus scrape configurations only support HTTP Basic Auth, bearer tokens (static), or client certificates. A constantly expiring JWT (`expiresIn: '15m'`) is impractical for Prometheus scraping. This means metrics collection is effectively broken in production unless a workaround exists.

2. **If someone adds `@Public()` to fix Prometheus scraping**, the endpoint becomes fully public — exposing:
   - All route paths (internal API structure)
   - Request counts and error rates per route (business intelligence leakage)
   - Node.js runtime metrics (heap size, GC behavior — potential side-channel for timing attacks)

3. The `route` label on the histogram (`stripe_http_request_duration_seconds`) exposes internal API structure. An attacker could enumerate endpoints, identify high-value targets (e.g., `/api/v1/payment-intents`), and infer traffic patterns.

### Recommendations

1. Add explicit access control suited for machine-to-machine communication:
   ```typescript
   @Controller('metrics')
   export class MetricsController {
     @Get()
     @UseGuards(MetricsAuthGuard)  // API key or static bearer token, NOT JWT
     async getMetrics(...) { ... }
   }
   ```
   Add `@Public()` to bypass JwtAuthGuard, then apply a purpose-built guard.
2. Implement a `MetricsAuthGuard` that validates a long-lived API key or a static bearer token from an environment variable (`METRICS_SCRAPE_TOKEN`).
3. Consider binding the metrics server to a separate, non-public port or using a Prometheus sidecar with TLS + mTLS.
4. Limit route cardinality by normalizing route paths (e.g., `/customers/:id` → `/customers/:id` is already handled by `request.route?.path`, which is good).

---

## Finding #6: AuditInterceptor — Opt-In, No Diffs, No Purge Job

| Attribute | Detail |
|-----------|--------|
| **Severity** | **MEDIUM** (CVSS-equivalent: 5.0) |
| **File(s)** | `apps/api/src/common/interceptors/audit.interceptor.ts`, `apps/api/src/audit/audit.service.ts`, `apps/api/src/database/migrations/008-create-audit-logs.ts` |
| **Type** | Compliance gap |

### Evidence

**Opt-in only:** The `AuditInterceptor` only records events on handlers decorated with `@Audit()`:
```typescript
if (!metadata) {
  return next.handle();  // Skip — no audit logging
}
```

This means:
- If a developer forgets to add `@Audit()`, the mutation goes unrecorded.
- No automatic audit of data reads (GDPR requires knowing who accessed PII).
- No automatic audit of authentication events (logins, failed logins, password changes).

**No before/after state:** Only the `action`, `resourceType`, and `resourceId` are captured. There is no diff of what changed. For example, if a customer's email is updated from `old@example.com` to `new@example.com`, the audit log would record `action: 'customer.update'` but NOT the old or new email. SOC2 CC6.1 requires auditable change records.

**No purge job implementation:** The migration creates a `RETENTION_DATE` column (90 days) and an index, but no scheduled purge job exists in the codebase:
```sql
RETENTION_DATE TIMESTAMP DEFAULT SYSDATE + 90
```

Without a purge job, audit logs accumulate indefinitely, which:
1. Violates the stated 90-day retention policy (ambiguous for GDPR — data kept longer than advertised).
2. Increases storage costs.
3. Creates unnecessary data exposure surface in case of a breach.

**Fire-and-forget swallows failures silently:** The try/catch in `AuditService.log()` is correct in not blocking business operations, but the error log entry could itself fail (e.g., logger transport broken), and there's no dead-letter queue or secondary audit channel.

**`audit.service.ts` uses Oracle-specific `SYSDATE` and positional params:**
The SQL uses `SYSDATE` (Oracle-specific) but the migration uses `SYSDATE` too. This is consistent but creates vendor lock-in. The positional params (`:1, :2, ...`) work but are fragile during schema changes.

### Recommendations

1. Add a global audit middleware or interceptor that records ALL authenticated requests (GET, POST, etc.) with resource path, not just decorated mutations.
2. Add `previousState` / `newState` diff columns (or JSON diff) for update operations.
3. Implement a scheduled purge job (e.g., `@Cron` from `@nestjs/schedule`, or a database job):
   ```typescript
   @Cron('0 2 * * *')  // Daily at 2 AM
   async purgeExpiredAuditLogs(): Promise<void> {
     await this.dataSource.query(
       `DELETE FROM AUDIT_LOGS WHERE RETENTION_DATE < SYSDATE`
     );
   }
   ```
4. Consider a dead-letter mechanism: if the audit write fails, write to a local file buffer or redis queue for retry.
5. Add audit coverage tests: a CI check that fails if a POST/PUT/PATCH/DELETE controller handler is missing `@Audit()`.

---

## Finding #7: Log Retention Insufficient for PCI-DSS 1-Year Requirement

| Attribute | Detail |
|-----------|--------|
| **Severity** | **HIGH** (CVSS-equivalent: 6.5) |
| **File(s)** | `apps/api/src/logging/logger.module.ts` (lines 38-52) |
| **Type** | Compliance gap |

### Current Configuration

```typescript
// Combined logs: 5 files × 50MB = 250MB max
{ target: 'pino-roll', options: { file: 'logs/combined.log', size: '50m', limit: { count: 5 } } },
// Error logs: 5 files × 10MB = 50MB max
{ target: 'pino-roll', level: 'error', options: { file: 'logs/error.log', size: '10m', limit: { count: 5 } } },
```

**Total: 300MB max, rolling FIFO.**

### PCI-DSS Req. 10.7 Compliance Analysis

| PCI-DSS 10.7 Requirement | Status | Gap |
|---|---|---|
| Retain audit logs for at least 12 months | ❌ FAIL | 300MB rollover likely covers days/weeks, not months |
| At least 3 months immediately available for analysis | ❌ FAIL | Rollover deletes oldest logs first |
| Archived logs must be protected from tampering | ❌ FAIL | No archival mechanism exists |
| Logs must be written so they cannot be altered | ❌ FAIL | Plain files, no WORM or integrity verification |
| Promptly back up audit trail files to centralized log server | ❌ FAIL | No off-host log shipping configured |

### Volume Estimate

A production Stripe API with moderate traffic (1,000 req/min) generating ~500 bytes/log line would produce:
- ~720 MB/day of combined logs
- The 250MB combined log buffer would fill in ~8 hours, losing all prior data

### Recommendations

1. **Implement centralized log shipping** (e.g., pino-elasticsearch, pino-syslog, or stdout → fluentd/fluent-bit → Elasticsearch/S3):
   ```typescript
   targets: [
     { target: 'pino/file', options: { destination: 1 } },  // stdout for container log driver
     { target: 'pino-roll', options: { file: 'logs/error.log', size: '50m', limit: { count: 20 } } },
   ]
   ```
2. Configure the container orchestrator (Kubernetes, ECS) to ship stdout to CloudWatch/Splunk/Datadog with 12-month retention.
3. For file-based logs, integrate with `logrotate` with `dateext` and `maxage 365` on the host.
4. Add a separate **PCI audit log stream** that only contains security-relevant events (auth, access, mutations) and is shipped to an immutable S3 bucket with WORM locking (S3 Object Lock in Compliance mode).
5. Document log retention in the data retention policy.

---

## Finding #8: Log Files Not Encrypted at Rest

| Attribute | Detail |
|-----------|--------|
| **Severity** | **MEDIUM** (CVSS-equivalent: 5.5) |
| **File(s)** | `apps/api/src/logging/logger.module.ts` |
| **Type** | Compliance gap |

### Evidence

`pino-roll` writes to plain files on disk:
```typescript
{ target: 'pino-roll', options: { file: 'logs/error.log', ... } },
{ target: 'pino-roll', options: { file: 'logs/combined.log', ... } },
```

No encryption is applied to these files. If an attacker gains filesystem access (e.g., via a path traversal vulnerability, compromised dependency, or container escape), they can read all historical logs, which may contain:
- Redacted-but-still-sensitive data (partial emails, IPs, user IDs)
- Correlation IDs that could be used to trace incident response
- Internal API route structure and error patterns (intelligence gathering)

### PCI-DSS Applicability

PCI-DSS Req. 3.4 requires that PAN be rendered unreadable anywhere it is stored. While PAN should not be in logs (if Findings #1-#3 are fixed), the log files are the **detective control** that proves compliance. If the detective control itself is vulnerable, auditors may consider this a compensating control gap.

### Recommendations

1. **Filesystem-level encryption** (minimum): Ensure the log directory is on an encrypted volume (LUKS, EBS encryption, etc.).
2. **Application-level encryption** (preferred): Use `pino-socket` or a custom writable stream that encrypts logs before writing:
   ```typescript
   const encryptStream = crypto.createCipheriv('aes-256-gcm', key, iv);
   ```
3. Move logs off-instance entirely — ship to a centralized logging service with encryption at rest (CloudWatch Logs with KMS, Elasticsearch with field-level encryption).
4. Document encryption status in the security architecture document.

---

## Finding #9: Correlation ID Header Injection

| Attribute | Detail |
|-----------|--------|
| **Severity** | **LOW** (CVSS-equivalent: 3.7) |
| **File(s)** | `apps/api/src/common/middleware/correlation-id.middleware.ts` |
| **Type** | Input validation gap |

### Evidence

```typescript
const correlationId =
  (req.headers['x-correlation-id'] as string) ??
  (req.headers['x-request-id'] as string) ??
  uuidv4();
```

The incoming header values are accepted **without validation**. An attacker could:

1. **Log injection via correlation ID:** Submit a correlation ID like:
   ```
   X-Correlation-Id: abc123\n[ATTACKER] Injected log line with fake severity
   ```
   If the logging pipeline doesn't escape newlines, this creates forged log entries. Modern structured logging (pino JSON) mitigates this, but if logs are ever viewed as plaintext (e.g., `cat logs/combined.log`), it could confuse incident responders.

2. **Correlation ID length DoS:** Submit a 10MB correlation ID. This fills log lines with garbage, exhausting log storage. A UUID is 36 characters; there's no max-length check.

3. **Correlation ID forgery across services:** If the downstream service trusts `x-correlation-id` from responses blindly, an attacker could use a predictable or malicious ID to confuse distributed tracing.

### Recommendations

1. Validate and sanitize incoming correlation IDs:
   ```typescript
   const MAX_ID_LENGTH = 64;
   const VALID_ID = /^[a-zA-Z0-9\-_.]+$/;

   function sanitizeCorrelationId(raw?: string): string {
     if (raw && raw.length <= MAX_ID_LENGTH && VALID_ID.test(raw)) {
       return raw;
     }
     return uuidv4();
   }
   ```
2. Consider always generating a new UUID server-side and only using the incoming header for response propagation, not as the authoritative log ID. This way, your logs are always UUID-format and immune to injection.

---

## Finding #10: Webhook Raw Body Could Leak Through Indirect Paths

| Attribute | Detail |
|-----------|--------|
| **Severity** | **MEDIUM** (CVSS-equivalent: 6.3) |
| **File(s)** | `apps/api/src/common/guards/webhook-signature.guard.ts`, `apps/api/src/main.ts` |
| **Type** | Data leakage vector |

### Evidence

`main.ts` enables raw body capture globally:
```typescript
const app = await NestFactory.create(AppModule, {
  rawBody: true,  // req.rawBody available for Stripe signature verification
});
```

This is necessary for webhook signature verification. However, `rawBody` is a `Buffer` attached to every request, not just webhook requests. If any middleware, interceptor, or filter accesses `req.rawBody` on a non-webhook request and passes it to a logger, the raw body (potentially containing full PAN, CVC, PII) leaks to logs.

The `WebhookSignatureGuard` correctly handles this:
```typescript
// Logs absence of signature/body — never the body content
this.logger.warn({
  message: 'Webhook request missing stripe-signature header',
  correlationId: request.correlationId,
  ip: request.ip,
});
```

But `rawBody` is on the request object globally. Any developer debugging a POST endpoint could inadvertently:
```typescript
this.logger.debug({ rawBody: req.rawBody?.toString() }, 'Request debugging');
// ☠️ FULL RAW BODY IN LOGS
```

**Stripe webhook payloads contain:**
- Customer names, emails, addresses
- Payment method details (last4, brand, exp_month, exp_year)
- Subscription metadata
- Full card fingerprint

### Recommendations

1. **Delete `rawBody` after webhook verification** to prevent downstream access:
   ```typescript
   // In WebhookSignatureGuard, after verification:
   delete (request as any).rawBody;
   ```
2. Consider using `express.raw({ type: 'application/json' })` only on the webhook route instead of global `rawBody: true`. This scopes the raw body capture to where it's needed.
3. Add an ESLint rule that prevents accessing `req.rawBody` outside the webhook guard.

---

## Finding #11: `sanitizePath` Strips Query Params but Path Itself May Contain Secrets

| Attribute | Detail |
|-----------|--------|
| **Severity** | **LOW** (CVSS-equivalent: 3.1) |
| **File(s)** | `apps/api/src/logging/sanitize.ts` (line 29-31), `apps/api/src/common/filters/all-exceptions.filter.ts` |
| **Type** | Partial protection |

### Evidence

```typescript
export function sanitizePath(url: string): string {
  return url.split('?')[0].split('#')[0];
}
```

This strips query parameters and URL fragments, but:

1. **Path parameters are not sanitized.** If a route is `/customers/:id/payment-methods/:pmId`, the logged path is `/api/v1/customers/cus_ABC123/payment-methods/pm_XYZ789`. These Stripe IDs are not technically secrets, but they do reveal:
   - Customer object IDs that could be used in API calls
   - Payment method IDs that could be cross-referenced

2. **Query params in error paths are stripped, but body params are not.** In `AllExceptionsFilter`, if an `HttpException` carries a validation error with the user's input, that input (potentially containing PII) is included in `exceptionResponse.message`.

### Recommendations

1. Normalize path parameters in `sanitizePath`:
   ```typescript
   export function sanitizePath(url: string): string {
     return url
       .split('?')[0]
       .split('#')[0]
       .replace(/\/cus_[A-Za-z0-9]+\b/g, '/:customerId')
       .replace(/\/pm_[A-Za-z0-9]+\b/g, '/:paymentMethodId')
       .replace(/\/pi_[A-Za-z0-9]+\b/g, '/:paymentIntentId')
       .replace(/\/sub_[A-Za-z0-9]+\b/g, '/:subscriptionId')
       .replace(/\/si_[A-Za-z0-9]+\b/g, '/:setupIntentId');
   }
   ```
2. Or better: use `request.route?.path` (the route pattern) instead of `request.url` (the resolved path) in log messages. This is already partially done in `MetricsInterceptor`:
   ```typescript
   const route = request.route?.path ?? 'unknown';
   ```

---

## Finding #12: No Log Integrity Protection

| Attribute | Detail |
|-----------|--------|
| **Severity** | **MEDIUM** (CVSS-equivalent: 5.9) |
| **File(s)** | `apps/api/src/logging/logger.module.ts` |
| **Type** | Compliance gap |

### Evidence

Logs are written as plain files via `pino-roll` with no:
- **Hash chaining** (each log line hashes the previous — like a blockchain-lite)
- **Digital signatures** (HMAC or asymmetric signature on log files)
- **Write-once protection** (files can be modified or deleted by anyone with filesystem access)
- **Centralized log collectors** (no syslog, fluentd, or log shipper configured in the application itself)

### PCI-DSS 10.5 Relevance

PCI-DSS 10.5 requires that audit trails be secured so they cannot be altered. Plain files on the application server are trivially alterable by anyone with shell access (including a compromised process running as the app user).

### Recommendations

1. Ship logs to a centralized, append-only destination (CloudWatch with log group immutability, S3 with Object Lock, Splunk, Datadog).
2. If local files are retained for operational reasons, use `logrotate` with `create` mode and restrict permissions:
   ```bash
   chmod 640 logs/*.log
   chown app:logging logs/
   ```
3. Consider signed log entries using a Merkle tree approach (e.g., Trillian, or a simpler HMAC-chaining implementation in the log transport).

---

## Compliance Gap Matrix

### PCI-DSS v4.0

| Requirement | Description | Status | Finding(s) |
|---|---|---|---|
| **3.2** | Do not store sensitive authentication data (CVC, full track) after authorization | ⚠️ PARTIAL | #2, #3 — CVC may be in raw body or request logs |
| **3.4** | Render PAN unreadable anywhere it is stored | ❌ FAIL | #1, #2, #3 — SAN not implemented; req body not redacted |
| **6.5** | Protect against injection flaws (log injection) | ⚠️ PARTIAL | #9 — correlation ID header unvalidated |
| **10.2** | Implement automated audit trails | ⚠️ PARTIAL | #6 — audit is opt-in, not comprehensive |
| **10.3** | Record specific audit event details (who, what, when, where, result) | ⚠️ PARTIAL | #6 — missing before/after state, source IP on all events |
| **10.5** | Secure audit trails from alteration | ❌ FAIL | #12 — no integrity protection |
| **10.7** | Retain logs for 12 months (3 immediately available) | ❌ FAIL | #7 — 300MB rollover, no archival |
| **11.5** | Detect and alert on unauthorized changes to log files | ❌ FAIL | #12 — no FIM or integrity monitoring |

### SOC2 (CC6.x)

| Criteria | Description | Status | Finding(s) |
|---|---|---|---|
| **CC6.1** | Logical and physical access controls — audit logging of access | ⚠️ PARTIAL | #6 — reads not audited; auth events not automatically captured |
| **CC6.6** | External communication threats — monitoring/alerting on anomalies | ❌ FAIL | #4 — Sentry data unscrubbed; no log-based alerting on anomalies |
| **CC6.7** | Data confidentiality — encryption of sensitive data | ❌ FAIL | #8 — logs unencrypted; #3 — PII may be in logs |
| **CC7.2** | System changes — monitor for unauthorized changes | ⚠️ PARTIAL | #6 — audit trails don't capture config/role changes |
| **CC7.3** | Incident detection — log review, anomaly detection | ⚠️ PARTIAL | #4 — Sentry data quality compromised by no scrubbing rules |

### GDPR

| Article | Description | Status | Finding(s) |
|---|---|---|---|
| **Art. 5(1)(e)** | Storage limitation — keep PII no longer than necessary | ⚠️ PARTIAL | #7 — no retention enforcement; #6 — no purge job |
| **Art. 25** | Data protection by design and default | ❌ FAIL | #1 — sanitizer dead code = security theater |
| **Art. 32** | Security of processing — encryption, resilience | ❌ FAIL | #8 — no encryption at rest for logs; #4 — Sentry unsanitized |
| **Art. 33** | Breach notification — ability to detect breaches | ⚠️ PARTIAL | #6 — incomplete audit trail reduces forensic capability |
| **Art. 35** | DPIA — logging systems require DPIA for PII processing | ⚠️ N/A | Logging system processes PII — DPIA may be required |

---

## Remediation Priority Matrix

| Priority | Finding | Effort | Impact |
|---|---|---|---|
| **P0 — Immediate** | #1: Wire `sanitizeFields` into pino pipeline | 2 days | Closes critical PII/PAN exposure gap |
| **P0 — Immediate** | #3: Add `res` serializer; prohibit raw body logging | 1 day | Prevents response body PII leakage |
| **P1 — This Sprint** | #2: Expand pino redact paths + add wildcard support | 1 day | Closes known redaction gaps |
| **P1 — This Sprint** | #4: Add `beforeSend` scrubbing to Sentry init | 0.5 day | Prevents PII in error reports |
| **P1 — This Sprint** | #7: Configure centralized log shipping + 12-month retention | 3 days | PCI-DSS 10.7 compliance |
| **P2 — Next Sprint** | #5: Add purpose-built metrics auth guard | 1 day | Secure Prometheus scraping |
| **P2 — Next Sprint** | #6: Add purge job + expand audit coverage | 3 days | SOC2 CC6.1 + GDPR Art. 5 |
| **P2 — Next Sprint** | #8: Enable filesystem encryption; document | 1 day + ops | GDPR Art. 32 |
| **P3 — Backlog** | #9: Validate correlation ID format/length | 0.5 day | Defense-in-depth |
| **P3 — Backlog** | #10: Delete rawBody after webhook verification | 0.5 day | Defense-in-depth |
| **P3 — Backlog** | #11: Normalize Stripe IDs in path logging | 0.5 day | Best practice |
| **P3 — Backlog** | #12: Implement log integrity (hash chaining or ship-off-box) | 2 days | PCI-DSS 10.5 |

---

## Summary

The observability stack has a **well-intentioned but incomplete security posture**. The team clearly understood the need for sanitization (evidenced by `sanitize.ts`, the pino `redact` config, and careful serializer design), but the implementation has critical gaps:

1. **The custom sanitizer is dead code** — the highest severity finding because it creates a false sense of security.
2. **Request/response bodies are not systematically redacted** — the most likely vector for PAN/PII in logs.
3. **Sentry has no PII scrubbing** — a high-risk vector given Sentry is a third-party SaaS outside the PCI boundary.
4. **Log retention is far below PCI-DSS requirements** — a compliance blocker.
5. **The audit trail is opt-in** — insufficient for SOC2 and GDPR.

**Overall grade: D+ (Significant compliance gaps requiring remediation before production deployment of payment processing).**

---

*End of audit report.*
