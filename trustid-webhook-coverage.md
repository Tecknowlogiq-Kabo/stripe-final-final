# TrustID Webhook Coverage — Complete Analysis

## 1. Every TrustID Webhook Endpoint and Event Type

### Single Endpoint: `POST /api/v1/webhooks/trustid`
**File:** `apps/api/src/webhooks/trustid-webhook.controller.ts` (full file, 215 lines)

**Access:** `@Public()` — no JWT required. TrustID sends callbacks to this URL with no authentication.

Three webhook event types are routed by `WorkflowName` + `WorkflowState`:

| # | WorkflowName | WorkflowState | Meaning | Handler | Processing |
|---|-------------|--------------|---------|---------|-------------|
| 1 | `AutoReferral` | `Start` | Guest completed document upload → container submitted | `TrustIdContainerHandler.handle()` | **Inline (fire-and-forget)**: looks up trust token by containerId, sets status to `submitted` |
| 2 | `AutoReferral` | `Stop` | Verification complete — results available | Enqueued to `TrustIdWebhookProcessor` | **Async (BullMQ)**: pulls all documents/images from TrustID → uploads to S3 → generates PDF report → stores assessment JSON → marks token approved |
| 3 | `UpdateDocument` | `Start` | Document modified AFTER result published (post-result update) | Logged only | **No action taken** — token already processed, S3 files already stored |

**Payload structure** (identical for all three webhook types):
```typescript
// Defined in: apps/api/src/webhooks/handlers/trustid-container.handler.ts (lines 7-61)
{
  Callback: {
    CallbackId: string,           // unique webhook delivery ID
    ProcessName: string,
    State: number,
    WorkflowName: "AutoReferral" | "UpdateDocument",
    WorkflowState: "Start" | "Stop",
    ErrorMessage: string | null,
    WorkflowStorage: [            // array of Key/Value pairs
      { Key: "ContainerId", Value: "54eaaf9a-..." },
      { Key: "DocumentId",  Value: "..." | null },    // populated for UpdateDocument
      { Key: "ClientApplicationReference", Value: "..." | null }
    ]
  },
  Response: {
    ContainerId: string,
    Success: boolean,
    Message: string
  }
}
```

**ContainerId extraction** (`extractContainerId()` in `trustid-container.handler.ts`, lines 63-74):
- Primary: `Callback.WorkflowStorage` array → find `Key === "ContainerId"`
- Fallback: `Response.ContainerId`

### Secondary Endpoint: `POST /trust/webhook` (Trust Token Webhook)
**File:** `apps/api/src/trust/trust.controller.ts` (lines 121-143)

A separate public endpoint that allows external systems to approve/deny trust tokens directly:
```json
{ "trustId": "eyJhbGciOi...", "action": "approve" | "deny" }
```
Calls `TrustService.approve()` or `TrustService.deny()`. Not part of the TrustID Cloud callback flow — designed for orchestrator/internal systems.

---

## 2. TrustID Service and Module Structure

### Files in `apps/api/src/trustid/`
| File | Lines | Purpose |
|------|-------|---------|
| `trustid.service.ts` | 285 | Full TrustID Cloud API client — auth, guest links, retrieval |
| `trustid.controller.ts` | 161 | REST endpoints for client-frontend interaction |
| `trustid.module.ts` | 19 | `@Global()` module wiring HttpModule + TrustModule |
| `dbs-status.constants.ts` | 80 | DBS status codes, interpretations, and token mapping |
| `dto/create-guest-link.dto.ts` | 87 | Validation DTO for guest link creation |

### Files in `apps/api/src/webhooks/` (TrustID-specific)
| File | Lines | Purpose |
|------|-------|---------|
| `trustid-webhook.controller.ts` | 215 | Webhook intake & routing by WorkflowName+WorkflowState |
| `trustid-webhook.module.ts` | 58 | Module: 2 BullMQ queues (main + DLQ), imports TrustModule/TrustIdModule/S3Module |
| `trustid-webhook.processor.ts` | 284 | BullMQ WorkerHost: pull docs from TrustID → S3 → approve token |
| `trustid-webhook-queue.constants.ts` | 2 | `TRUSTID_WEBHOOK_QUEUE` = `'trustid-webhooks'`, `TRUSTID_WEBHOOK_DLQ` = `'trustid-webhooks-dlq'` |
| `handlers/trustid-container.handler.ts` | 137 | Handles Container Submitted (`Start`) webhooks |
| `handlers/trustid-result.handler.ts` | 114 | Validates result payloads, looks up trust tokens, shared utility |

### Architecture Diagram
```
┌───────────────────────────────────────────────────────────┐
│                    TrustID Cloud                           │
│  (sends POST to /api/v1/webhooks/trustid)                 │
└───────────────────────────┬───────────────────────────────┘
                            │
         ┌──────────────────▼──────────────────────┐
         │  TrustIdWebhookController                │
         │  @Public() @SkipThrottle()               │
         │  Routes by WorkflowName+WorkflowState    │
         └──────┬──────────────┬──────────┬────────┘
                │              │          │
    AutoReferral+Start  AutoReferral+Stop  UpdateDocument+Start
                │              │          │
         ┌──────▼──────┐  ┌───▼────────┐ │
         │ Container    │  │ BullMQ     │ │
         │ Handler      │  │ Queue      │ │
         │ (inline)     │  │            │ │
         │ set status   │  └───┬────────┘ │
         │ → submitted  │      │          │
         └──────────────┘  ┌───▼────────────┐
                           │ Processor      │        ┌──────────────┐
                           │ (WorkerHost)   │───────▶│ TrustIdService│
                           │ pullAndStore() │        │ (API client)  │
                           └───┬────────────┘        └──────┬───────┘
                               │                            │
                    ┌──────────┼──────────┐                 │
                    ▼          ▼          ▼                 │
              retrieveContainer retrieveImage  exportPDF    │
                    │          │          │                 │
                    ▼          ▼          ▼                 │
               ┌────────────────────────────────┐          │
               │         S3 Bucket               │          │
               │  users/{userId}/trust-approved/ │          │
               │    {containerId}/               │          │
               │    documents/{imageId}.{ext}    │          │
               │    report.pdf                   │          │
               │    assessment.json              │          │
               └────────────────────────────────┘          │
                                                           │
               ┌──────────────────────────────┐            │
               │  TrustRepository              │◄───────────┘
               │  updateStatus → approved      │
               │  updateMetadata (DBS status)  │
               └──────────────────────────────┘
```

---

## 3. TrustID Webhook Flow: Receipt → Processing

### Flow for Container Submitted (`AutoReferral` + `Start`)
1. Guest completes document upload in the TrustID Cloud guest link
2. TrustID Cloud sends `POST /api/v1/webhooks/trustid` with `WorkflowName="AutoReferral"`, `WorkflowState="Start"`
3. `TrustIdWebhookController.handleAutoReferral()` (lines 110-117) fires `TrustIdContainerHandler.handle()` as fire-and-forget
4. Handler extracts `containerId` from `Callback.WorkflowStorage`
5. Looks up trust token via `TrustRepository.findByResourceId(containerId)` — maps using `trustidContainerId` stored in token metadata
6. If found: `TrustRepository.updateStatus(tokenId, 'submitted')`
7. If not found: logs warning, returns — submission tracked but not linked

### Flow for Result Notification (`AutoReferral` + `Stop`)
1. TrustID Cloud finishes verification processing
2. TrustID Cloud sends `POST /api/v1/webhooks/trustid` with `WorkflowName="AutoReferral"`, `WorkflowState="Stop"`
3. `TrustIdWebhookController.handleAutoReferral()` (lines 119-172) enqueues a BullMQ job with `{ containerId, callbackId }`
4. **Immediate 200 OK returned** — BullMQ handles the rest asynchronously
5. `TrustIdWebhookProcessor.process()` (lines 66-102):
   - Wrapped in OTel span with containerId, jobId, attempt attributes
   - Calls `pullAndStore(containerId)`:
     a. Looks up trust token by `containerId`
     b. `TrustIdService.retrieveDocumentContainer(containerId)` — gets full container with documents, images, DBS status
     c. For each document → for each image: `retrieveImage(imageId)` → `S3Service.upload()` to `users/{userId}/trust-approved/{containerId}/documents/{imageId}.{ext}`
     d. `TrustIdService.exportPDF(containerId)` → `S3Service.upload()` to `users/{userId}/trust-approved/{containerId}/report.pdf`
     e. Computes DBS interpretation, builds `assessment.json` → `S3Service.upload()`
     f. Maps DBS status → token status via `DBS_STATUS_TO_TOKEN_STATUS`; falls back to `'approved'` for non-DBS checks
     g. `TrustRepository.updateStatus(tokenId, tokenStatus)`
     h. Updates token metadata with `dbsStatus`, `dbsInterpretation`, `dbsTerminal`, `documentAssessment`
6. **Retry policy**: 5 attempts, exponential backoff (10s base)
7. **On exhaustion**: job moved to `trustid-webhooks-dlq` via `@OnWorkerEvent('failed')`

### Flow for UpdateDocument (`UpdateDocument` + `Start`)
1. TrustID Cloud sends post-result document update webhook
2. `TrustIdWebhookController.handleUpdateDocument()` (lines 177-197) logs the event with `containerId`, `callbackId`, `documentId`
3. **No action taken** — token already processed, files already in S3

---

## 4. TrustID Webhook Auth/Verification

### Current State: NO authentication
- The `POST /api/v1/webhooks/trustid` endpoint is `@Public()` — no JWT, no signature verification
- `@SkipThrottle()` — no rate limiting (critical delivery path)
- The only "identifier" is the `ContainerEventCallbackUrl` passed during guest link creation, which TrustID calls directly

### What TrustID Supports
- `ContainerEventCallbackHeaders` can be set when creating a guest link — allows passing custom HTTP headers that TrustID will include in webhook requests
- Currently defaulted to `[]` (empty array) in `createGuestLink()` (line 255 of `trustid.service.ts`)
- The DTO supports `callbackHeaders` via `CallbackHeaderDto` — `{ Header: string, Value: string }[]`

### Gap: No webhook signature verification
Unlike Stripe webhooks (which use `WebhookSignatureGuard` with HMAC-SHA256 signing), TrustID webhooks have NO cryptographic verification. Any caller who knows the URL can submit fake webhooks. Possible mitigations:
- Use `ContainerEventCallbackHeaders` to pass a shared secret token
- Validate the secret in a custom guard on the TrustID webhook endpoint
- Or use TrustID's `CallbackId` as an idempotency key (already logged, but not verified for replay)

### Comparison: Stripe vs TrustID webhook auth
| Feature | Stripe Webhooks | TrustID Webhooks |
|---------|----------------|-----------------|
| Endpoint | `POST /api/v1/webhooks/stripe` | `POST /api/v1/webhooks/trustid` |
| Access | `@Public()` | `@Public()` |
| Signature verification | `WebhookSignatureGuard` — HMAC-SHA256 | **None** |
| Secret config | `stripe.webhookSecret` env var | **None** |
| Rate limiting | `@SkipThrottle()` | `@SkipThrottle()` |
| Idempotency | `event.id` dedup | `CallbackId` logged but not deduped |
| Raw body needed | Yes (`rawBody` buffer) | No |

---

## 5. TrustID Integration with Stripe (Checkout Session Flow)

### How trustId connects Stripe Checkout → TrustID verification

**Flow:**
1. **Guest link creation**: `POST /trustid/guest-link` (JWT-authenticated)
   - `TrustIdController.createGuestLink()` (trustid.controller.ts, lines 28-79)
   - `TrustIdService.createGuestLink()` calls TrustID Cloud API, gets `containerId` + `guestLinkUrl`
   - `TrustService.generateTrustToken()` creates a local trust token with metadata:
     ```json
     {
       "trustidLinkId": "...",
       "trustidContainerId": "54eaaf9a-...",
       "trustidGuestLink": "https://...",
       "trustidGuestEmail": "...",
       "trustidGuestName": "..."
     }
     ```
   - Returns `trustId` (JWT), `guestLink`, `containerId`, `qrCodeDataUrl`

2. **Stripe Checkout Session**: When creating a checkout session externally, `trustId` is placed in the session's `metadata.trustId` field

3. **Checkout completion**: Stripe sends `checkout.session.completed` webhook → `POST /api/v1/webhooks/stripe`
   - `WebhookSignatureGuard` verifies Stripe signature
   - `WebhooksService` dispatches to `CheckoutSessionHandler`

4. **Auto-approval via checkout**: `CheckoutSessionHandler.handleCompleted()` (checkout-session.handler.ts, lines 46-74):
   ```typescript
   const trustId = session.metadata?.trustId;
   if (!trustId) return; // no trustId in metadata — skip
   const approved = await this.trustService.approve(trustId);
   ```
   - Calls `TrustService.approve(trustId)` which:
     - Validates the JWT trust token
     - Checks token status is `pending` or `submitted`
     - Sets status to `approved`
     - For `resourceType === 'file'`: pulls file from sourceUrl → S3
     - For `resourceType === 'trustid-check'`: the documents were already pulled to S3 by the webhook processor — approval is just a status change
   - This is the **payment-gated** approval path: the trustId is approved ONLY after successful Stripe payment

5. **Status flow for trustid-check resources**:
   ```
   pending → [guest uploads docs] → submitted → [TrustID verifies] → approved
                                                     ↑                    ↑
                                         AutoReferral+Stop      checkout.session.completed
                                         (processor pulls to    (TrustService.approve)
                                          S3 + sets approved)
   ```
   **Note:** Both the TrustID result webhook processor AND the checkout session handler can set status to `approved`. The processor handles the S3 document pull; the checkout handler handles the payment gate. They operate independently — both must succeed for a complete flow.

---

## 6. Missing TrustID Webhooks / Gaps

### Already addressed (from `plans/trustid-docs-analysis.md`)

| Gap | Status | Evidence |
|-----|--------|----------|
| P0: Post-Result webhook misrouting | ✅ Fixed | `trustid-webhook.controller.ts` routes by WorkflowName+WorkflowState (lines 87-105) |
| P1: Missing DTO fields (rtraAgentName, rtwCompanyName) | ✅ Fixed | `create-guest-link.dto.ts` lines 63-71; `trustid.service.ts` lines 32-34, 261-262 |
| P2: DBS status code mapping | ✅ Fixed | `dbs-status.constants.ts` — full mapping with 10 statuses, interpretations, and token mappings |
| P3: ClientApplicationReference default | ✅ Fixed | `trustid.service.ts` line 259: gated with `!== undefined && !== ''` |
| P4: Document assessment feedback storage | ✅ Fixed | `trustid-webhook.processor.ts` lines 185-215: stores `assessment.json` in S3 with DBS interpretation + document-level assessment |
| UpdateDocument handler | ✅ Fixed | `trustid-webhook.controller.ts` lines 177-197: distinct handler, logs only |
| DigitalIdentityScheme enum | ✅ Fixed | `trustid.service.ts` lines 13-19: `DigitalIdentityScheme` enum with `RightToRent = 1`, `RightToWork = 2` |
| QR code generation | ✅ Fixed | `trustid.controller.ts` lines 68-72: `QRCode.toDataURL()` |

### Remaining gaps

| # | Gap | Severity | Location | Description |
|---|-----|----------|----------|-------------|
| 1 | **No webhook signature verification** | 🔴 HIGH | `trustid-webhook.controller.ts` | Endpoint is totally unauthenticated. Use `ContainerEventCallbackHeaders` with a shared secret + validate in a guard. No replay protection (no CallbackId dedup). |
| 2 | **No webhook replay/idempotency check** | 🟡 MEDIUM | `trustid-webhook.controller.ts` | `CallbackId` is logged but never checked for duplicates. A redelivery could enqueue a duplicate job or fire `submitted` update again. |
| 3 | **Missing: Container Modified Post Result (Stop)** | 🟡 MEDIUM | `trustid-webhook.controller.ts` | `UpdateDocument` only handles `WorkflowState="Start"`. The `WorkflowState="Stop"` case for `UpdateDocument` is not explicitly handled — falls through to "Unknown WorkflowState" warning. | 
| 4 | **Session expiry edge case during S3 pull** | 🟡 MEDIUM | `trustid-webhook.processor.ts` | If the TrustID session expires mid-pull (e.g., retrieving 20 images), the processor will fail and retry (up to 5 times). The 30s refresh margin mitigates this but doesn't eliminate it for very large containers. |
| 5 | **No webhook delivery failure handling** | 🟡 MEDIUM | `trustid-webhook.controller.ts` | If TrustID can't reach our endpoint (down, network), there's no retry mechanism on TrustID's side documented. No health check endpoint specific to TrustID. |
| 6 | **`@Public()` — anyone can POST**  | 🟡 MEDIUM | `trustid-webhook.controller.ts` | Any caller who discovers the URL can submit forged webhooks that update trust token status. Mitigation: shared secret in callback headers. |
| 7 | **No dedicated TrustID webhook secret env var** | 🟡 MEDIUM | `.env.example` | Configuration has `trustid.apiKey`, `trustid.username`, `trustid.password` but no `trustid.webhookSecret` for header verification. |
| 8 | **Trust token `submitted` status overwrite** | 🟢 LOW | `trustid-container.handler.ts` lines 127-130 | If a duplicate `Start` webhook arrives, it sets status to `submitted` again. `TrustRepository.updateStatus()` should be idempotent but isn't gated on current status. |

---

## Start Here

For another agent starting work, open:
1. **`apps/api/src/webhooks/trustid-webhook.controller.ts`** — the entry point for all TrustID webhooks. Understand the routing logic (lines 60-105).
2. **`apps/api/src/webhooks/trustid-webhook.processor.ts`** — the BullMQ worker that does the heavy async S3 pull (lines 27-102 for `process()`, lines 107-217 for `pullAndStore()`).
3. **`apps/api/src/trustid/trustid.service.ts`** — the TrustID Cloud API client (auth, guest links, retrieval).
4. **`apps/api/src/webhooks/handlers/checkout-session.handler.ts`** — the Stripe → TrustID payment-gated approval bridge.

### Key files reference
| File | Purpose |
|------|---------|
| `apps/api/src/webhooks/trustid-webhook.controller.ts` | Webhook endpoint + routing |
| `apps/api/src/webhooks/trustid-webhook.module.ts` | Module wiring (queues, handlers, processor) |
| `apps/api/src/webhooks/trustid-webhook.processor.ts` | Async S3 document pull worker |
| `apps/api/src/webhooks/trustid-webhook-queue.constants.ts` | Queue name constants |
| `apps/api/src/webhooks/handlers/trustid-container.handler.ts` | Container Submitted handler + payload types |
| `apps/api/src/webhooks/handlers/trustid-result.handler.ts` | Result validation + token lookup |
| `apps/api/src/webhooks/handlers/checkout-session.handler.ts` | Stripe checkout → trustId auto-approve |
| `apps/api/src/trustid/trustid.service.ts` | TrustID Cloud API client |
| `apps/api/src/trustid/trustid.controller.ts` | Frontend REST endpoints |
| `apps/api/src/trustid/trustid.module.ts` | TrustIdModule (@Global) |
| `apps/api/src/trustid/dbs-status.constants.ts` | DBS status codes, interpretations, token mapping |
| `apps/api/src/trustid/dto/create-guest-link.dto.ts` | Guest link creation DTO |
| `apps/api/src/trust/trust.service.ts` | Trust token lifecycle (generate, approve, deny) |
| `apps/api/src/trust/trust.controller.ts` | Trust token webhook endpoint (line 121) |
| `apps/api/src/webhooks/webhooks.service.ts` | Stripe webhook dispatch registry |
| `apps/api/src/common/guards/webhook-signature.guard.ts` | Stripe signature verification (for comparison) |
