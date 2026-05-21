# TrustID: BullMQ-Powered Verified-File Pull to S3

## Context

The TrustID integration is partially built. We can:
- Create TrustID guest links via `TrustIdService.createGuestLink()` (Workflow 4 API)
- Receive webhooks from TrustID at `POST /api/v1/webhooks/trustid` (container submitted + verification complete)
- Pull verified documents from TrustID → S3 inside `TrustIdResultHandler` (fire-and-forget)
- Display a guest-facing trust page at `/trust/[trustId]` that polls for status

**What's missing for the full flow:**
1. **BullMQ queue for TrustID webhooks** — The `TrustIdResultHandler` runs synchronously in a fire-and-forget `.catch()`. It needs BullMQ for retry, DLQ, and observability (just like Stripe webhooks).
2. **Email delivery option** — Currently only TrustID can send the guest-link email via `sendEmail: true`. We need an in-house email service to send guest links ourselves.
3. **QR code generation** — For in-person or kiosk flows, the guest link should be displayable as a QR code on the frontend.
4. **Frontend iframe embedding** — The frontend trust page needs to embed the TrustID guest link in an iframe so users can upload documents inline (and/or show a QR code to scan on mobile).

## Approach

### Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  API Server  │────▶│  TrustID     │────▶│  User Email │  (email option)
│  creates     │     │  Cloud       │     │  or QR Code │  (QR option)
│  guest link  │     │  (upload)    │     └─────────────┘
└──────┬───────┘     └──────┬───────┘
       │                    │ webhook (verification complete)
       ▼                    ▼
┌──────────────────────────────────────┐
│  POST /api/v1/webhooks/trustid       │  ← TrustIdWebhookController
│  → enqueue to TRUSTID_WEBHOOK_QUEUE  │
└──────────────┬───────────────────────┘
               │ BullMQ
               ▼
┌──────────────────────────────────────┐
│  TrustIdWebhookProcessor             │  ← NEW WorkerHost
│  → pull documents from TrustID       │
│  → upload to S3                      │
│  → approve trust token               │
│  → retry + DLQ                       │
└──────────────────────────────────────┘
```

### Key decisions

1. **Separate BullMQ queue** (`trustid-webhooks`) — Not sharing the Stripe `stripe-webhooks` queue. Different retry policies, different handlers, cleaner isolation.

2. **QR code on the backend** — Generate QR as a data URL in the API response. The frontend just renders it. Use `qrcode` npm package (pure JS, no DOM dependency).

3. **Email service** — Create a lightweight `EmailService` using `@aws-sdk/client-ses` (since we already use AWS SDK for S3). Supports plain text + HTML. Extensible to other providers later.

4. **Frontend iframe** — The `trust/[trustId]/page.tsx` page detects when the token has a TrustID guest link in metadata and renders an iframe embedding it. Also renders the QR code as a toggle/alternative.

## Files to modify

### New files
- `apps/api/src/email/email.module.ts` — NestJS module for email
- `apps/api/src/email/email.service.ts` — SES-backed email sender
- `apps/api/src/webhooks/trustid-webhook.processor.ts` — BullMQ WorkerHost for TrustID
- `apps/api/src/webhooks/trustid-webhook-queue.constants.ts` — Queue name constants

### Modified files
- `apps/api/src/app.module.ts` — Import EmailModule
- `apps/api/src/config/configuration.ts` — Add `email:` and `trustid.queue` config blocks
- `apps/api/src/config/validation.schema.ts` — Add new env var validations
- `apps/api/.env.example` — Add new env vars
- `apps/api/src/webhooks/trustid-webhook.module.ts` — Register BullMQ queue + processor
- `apps/api/src/webhooks/trustid-webhook.controller.ts` — Enqueue webhook instead of fire-and-forget
- `apps/api/src/webhooks/handlers/trustid-result.handler.ts` — Refactor: extract S3 pull into processor
- `apps/api/src/trustid/trustid.controller.ts` — Add QR code to guest-link response
- `apps/api/src/trust/trust.service.ts` — Pass email preference to guest link creation
- `apps/web/src/app/trust/[trustId]/page.tsx` — Add iframe + QR code UI
- `apps/api/package.json` — Add `qrcode` dependency

## Reuse

| What | Where | How |
|------|-------|-----|
| `S3Service.upload()` | `apps/api/src/s3/s3.service.ts` | Already used by TrustIdResultHandler — reuse for file upload in processor |
| `TrustIdService.retrieveImage()` / `exportPdf()` / `retrieveDocumentContainer()` | `apps/api/src/trustid/trustid.service.ts` | Already called by handler — same calls in processor |
| `TrustRepository.findByResourceId()` / `updateStatus()` | `apps/api/src/trust/trust.repository.ts` | Already used for token mapping + status updates |
| `BullModule.forRootAsync()` | `apps/api/src/webhooks/webhooks.module.ts` | Already configured — just register another queue in trustid-webhook.module |
| `WebhookProcessor` pattern | `apps/api/src/webhooks/webhook.processor.ts` | Copy the `@Processor` + `WorkerHost` + `OnWorkerEvent('failed')` pattern |
| `TrustIdResultHandler.inferExtension()` | `apps/api/src/webhooks/handlers/trustid-result.handler.ts` | Move to a shared util or keep as private method in processor |
| `@aws-sdk/client-s3` (already installed) | `apps/api/package.json` | SES client is in the same SDK family — add `@aws-sdk/client-ses` |

## Steps

### Step 1: Add BullMQ queue for TrustID webhooks

- [ ] Create `apps/api/src/webhooks/trustid-webhook-queue.constants.ts` with `TRUSTID_WEBHOOK_QUEUE` and `TRUSTID_WEBHOOK_DLQ` constants
- [ ] Create `apps/api/src/webhooks/trustid-webhook.processor.ts` — a `WorkerHost` that:
  - Receives `{ containerId: string; callbackId?: string }` job data
  - Calls `TrustIdService.retrieveDocumentContainer()` to get all documents
  - Iterates document images, calls `TrustIdService.retrieveImage()` for each
  - Calls `S3Service.upload()` for each image (prefix: `users/{userId}/trust-approved/{containerId}/documents/`)
  - Calls `TrustIdService.exportPdf()` and uploads to `.../report.pdf`
  - Calls `TrustRepository.updateStatus(tokenId, 'approved')`
  - Has `@OnWorkerEvent('failed')` that moves exhausted jobs to DLQ
- [ ] Modify `apps/api/src/webhooks/trustid-webhook.module.ts`:
  - Register `TRUSTID_WEBHOOK_QUEUE` and `TRUSTID_WEBHOOK_DLQ` via `BullModule.registerQueue()`
  - Add `TrustIdWebhookProcessor` to providers
  - Inject `@InjectQueue(TRUSTID_WEBHOOK_QUEUE)` into the controller

### Step 2: Route "Stop" webhooks through BullMQ

- [ ] Modify `apps/api/src/webhooks/trustid-webhook.controller.ts`:
  - Inject the TrustID queue: `@InjectQueue(TRUSTID_WEBHOOK_QUEUE) private readonly trustIdQueue: Queue`
  - On `case 'Stop'`: enqueue `{ containerId, callbackId }` instead of calling `resultHandler.handle()` directly
  - Keep `case 'Start'` as fire-and-forget (lightweight status update, no file transfer)
  - Return `{ received: true, queued: true }` for Stop events

### Step 3: Clean up TrustIdResultHandler

- [ ] `apps/api/src/webhooks/handlers/trustid-result.handler.ts`:
  - Remove S3 pull logic (moved to processor)
  - Option A: Keep as a thin wrapper that the processor delegates to for token lookup only
  - Option B: Remove the handler entirely and inline token lookup in the processor
  - **Recommendation: Option A** — keep token lookup logic, rename to indicate it's now a helper

### Step 4: Email service for sending guest links

- [ ] Create `apps/api/src/email/email.module.ts` — `@Global()` module exporting `EmailService`
- [ ] Create `apps/api/src/email/email.service.ts`:
  - Uses `@aws-sdk/client-ses` `SendEmailCommand`
  - Method: `sendGuestLinkEmail(to: string, name: string, guestLink: string): Promise<void>`
  - HTML email with the guest link as a clickable button + plain-text fallback
  - Configurable `from` address via env
- [ ] Add `apps/api/package.json` dependency: `@aws-sdk/client-ses`
- [ ] Add `email:` config block to `configuration.ts` (from, region fallback to AWS region)
- [ ] Add env vars to `validation.schema.ts` and `.env.example`

### Step 5: QR code generation

- [ ] Add `qrcode` npm dependency to `apps/api/package.json`
- [ ] In `apps/api/src/trustid/trustid.controller.ts` `createGuestLink()`:
  - After creating the guest link, generate a QR code data URL: `await QRCode.toDataURL(result.guestLinkUrl)`
  - Return `qrCodeDataUrl` in the response
- [ ] In `apps/api/src/trust/trust.controller.ts` `getGuestLink()`:
  - Also return a QR code data URL for the guest link

### Step 6: Frontend iframe + QR code UI

- [ ] Modify `apps/web/src/app/trust/[trustId]/page.tsx`:
  - Fetch `GET /trust/:trustId/guest-link` to get the guestLink URL and QR code
  - If a TrustID guest link is available, render two tabs/options:
    - **"Upload Documents"** tab: embeds the TrustID guest link in a sandboxed iframe
    - **"Scan QR Code"** tab: displays the QR code image (for mobile scanning)
  - Keep polling for status changes (pending → submitted → approved/denied)
  - The iframe should use `sandbox="allow-scripts allow-forms allow-same-origin"` and `allow="camera"` for document capture

### Step 7: Add `emailGuestLink` option to token creation flow

- [ ] Modify `apps/api/src/trust/trust.service.ts` `generateTrustToken()`:
  - Add optional parameter: `sendEmailViaUs?: boolean`
  - If `sendEmailViaUs` is true and we have an email, call `EmailService.sendGuestLinkEmail()` after creating the TrustID guest link
  - This gives callers 3 options: (1) let TrustID send email via `sendEmail: true`, (2) we send the email, (3) neither (QR/iframe only)

### Step 8: Configuration & env vars

- [ ] Update `apps/api/src/config/configuration.ts`:
  ```ts
  email: {
    from: process.env.EMAIL_FROM ?? 'noreply@yourdomain.com',
    region: process.env.EMAIL_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  },
  trustid: {
    // ... existing ...
    queueAttempts: parseInt(process.env.TRUSTID_QUEUE_ATTEMPTS ?? '5', 10),
    queueBackoffDelay: parseInt(process.env.TRUSTID_QUEUE_BACKOFF_MS ?? '10000', 10),
  },
  ```
- [ ] Update `apps/api/src/config/validation.schema.ts` with new env vars
- [ ] Update `apps/api/.env.example` with new env vars

## Verification

1. **BullMQ flow end-to-end:**
   - Start Redis + API server + worker
   - Create a guest link via `POST /trustid/guest-link`
   - Simulate a TrustID "Stop" webhook: `curl -X POST http://localhost:3001/api/v1/webhooks/trustid -H 'Content-Type: application/json' -d '{"Callback":{"WorkflowState":"Stop","CallbackId":"test-123"},"Container":{"Id":"<real-container-id>"}}'`
   - Check BullMQ dashboard (or Redis) — job should be processed
   - Verify files appear in S3 at the expected prefix
   - Verify trust token status is updated to `'approved'`

2. **QR code:**
   - Call `POST /trustid/guest-link` — response should include `qrCodeDataUrl`
   - Open the data URL in a browser — should display a scannable QR code

3. **Email:**
   - Create a guest link with `sendEmailViaUs: true` (or call the email service directly)
   - Check inbox — should receive HTML email with the guest link

4. **Frontend iframe:**
   - Visit `/trust/[trustId]` for a token with a TrustID guest link
   - Should see the iframe embedded and the QR code tab
   - Status polling should update when container is submitted → verified

5. **DLQ handling:**
   - Cause a processor failure (e.g., invalid container ID, S3 error)
   - After all retries exhausted, job should appear in `trustid-webhooks-dlq`
   - Check logs for the error trail

6. **Run existing tests:**
   ```bash
   npm test -- --filter=api
   ```
