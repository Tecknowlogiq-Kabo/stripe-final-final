# TrustID Webhook Handlers — Implementation Summary

## Files Created

| File | Purpose |
|------|---------|
| `apps/api/src/webhooks/handlers/trustid-container.handler.ts` | Handles Container Submitted callback (WorkflowState: "Start") |
| `apps/api/src/webhooks/handlers/trustid-result.handler.ts` | Handles Result Notification callback (WorkflowState: "Stop") |
| `apps/api/src/webhooks/trustid-webhook.controller.ts` | Webhook endpoint at `POST /api/v1/webhooks/trustid` |
| `apps/api/src/webhooks/trustid-webhook.module.ts` | Module wiring TrustID handlers + dependencies |
| `apps/api/src/trustid/trustid.service.ts` | TrustID API client stub with full type definitions |
| `apps/api/src/trustid/trustid.module.ts` | TrustIdModule (@Global) |

## Files Modified

| File | Change |
|------|--------|
| `apps/api/src/app.module.ts` | Added `TrustIdWebhookModule` import |
| `apps/api/src/trust/trust.repository.ts` | Added `findByResourceId()` and `updateMetadata()` methods |
| `apps/api/src/webhooks/handlers/trustid-result.handler.ts` | Fixed imageId null check, updated to match Team A's retrieveImage return shape |

## Webhook Flow

```
TrustID Cloud creates guest link
         ↓
Guest completes document upload
         ↓
TrustID sends Container Submitted webhook → POST /api/v1/webhooks/trustid
  { Callback: { WorkflowState: "Start" }, Container: { Id: "..." } }
         ↓
TrustIdContainerHandler:
  - Extracts Container.Id
  - Looks up trust token via findByResourceId(containerId)
  - Updates token status → "submitted"
  - Returns 200 OK immediately
         ↓
TrustID processes documents (verification)
         ↓
TrustID sends Result Notification webhook → POST /api/v1/webhooks/trustid
  { Callback: { WorkflowState: "Stop" }, Container: { Id: "..." } }
         ↓
TrustIdResultHandler (fire-and-forget):
  1. Looks up trust token via findByResourceId(containerId)
  2. Calls trustIdService.retrieveDocumentContainer(containerId)
  3. For each document → trustIdService.retrieveImage(imageId) → s3Service.upload()
     S3 path: trust-approved/{containerId}/documents/{imageId}.{ext}
  4. Calls trustIdService.exportPDF(containerId) → s3Service.upload()
     S3 path: trust-approved/{containerId}/report.pdf
  5. Updates token status → "verification_complete" (documents in S3)
  On failure: marks token as "failed" with error details in metadata
         ↓
TrustService.approve() can be called to finalize the trust token
```

## Controller Design

- `@SkipThrottle()` — no rate limiting on webhook path
- `@Public()` — no JWT required (TrustID sends its own auth in callback URL)
- Routes to handler based on `Callback.WorkflowState`:
  - `"Start"` → TrustIdContainerHandler
  - `"Stop"` → TrustIdResultHandler
- Returns 200 OK immediately — handlers run as fire-and-forget (`.catch()` for errors)
- Handlers write errors to logger, never throw to caller

## Dependencies Between Teams

| Team | Owns | Consumed By |
|------|------|-------------|
| Team B (this) | TrustIdContainerHandler, TrustIdResultHandler, TrustIdWebhookController | AppModule |
| Team A | TrustIdService (real TrustID Cloud API calls) | TrustIdResultHandler (retrieveDocumentContainer, retrieveImage, exportPDF) |
| Team A | TrustService (approve/deny) | TrustIdContainerHandler (status updates) |
| Team C | S3Service (upload) | TrustIdResultHandler (document + PDF storage) |

## Compilation & Tests

- TypeScript: **0 errors**
- Tests: **12 suites, 75 tests, all passing**

## Next Steps

1. Team A: Implement TrustIdService with real TrustID Cloud API calls (authenticate, createGuestLink, retrieveDocumentContainer, retrieveImage, exportPDF)
2. Configure `ContainerEventCallbackUrl` in TrustID guest link creation to point to `POST /api/v1/webhooks/trustid`
3. Set TrustID environment variables: `TID_API_KEY`, `TID_BASE_URL`, `TID_USERNAME`, `TID_PASSWORD`
4. Create the `TRUST_TOKENS` Oracle table if not already created
5. Register the TrustID webhook URL in the TrustID Cloud dashboard
