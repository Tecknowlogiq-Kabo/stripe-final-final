# TrustID Workflow 4 — Documentation vs Implementation Analysis

## Context

Analyzed the full TrustID Workflow 4 documentation at `https://developer.trustid.co.uk/documentation/topics/workflow4_intro.html` and all 8 sub-pages, compared against the existing implementation in this codebase.

**Goal:** Identify gaps, bugs, and missing features between the official TrustID API and what we've built.

---

## Documentation Pages Analyzed

| Page | URL | Content |
|------|-----|---------|
| Workflow Overview | `workflow4.html` | High-level flow: create guest links → guest uploads → webhooks → retrieve results |
| Guest Links | `guestLink.html` | Creating guest links with flexible fields, callbacks, digital identity, RTR/RTW share codes |
| Container Submitted Webhook | `webhookcallbacksample4.html` | `WorkflowState="Start"` callback with `WorkflowStorage` |
| Result Notification Webhook | `webhookcallback4.html` | `WorkflowState="Stop"` callback — verification complete |
| Authentication | `auth4.html` | Login/logout, password management, CORS, image resources |
| Retrieving Content | `retrieve4.html` | Retrieve applications, documents, images, PDF reports |
| Interpreting Results | `results4.html` | Container/Document data, DBS status codes, assessment feedback |
| Post-Result Webhook | `webhookcallbackpostresult4.html` | `WorkflowName="UpdateDocument"` — container modified after result |

---

## ✅ Correctly Implemented

| Feature | Where | Assessment |
|---------|-------|-----------|
| **Login with DeviceId** | `trustid.service.ts:login()` | Correct: stable deviceId, session caching with TTL, 30s refresh margin |
| **Session/DeviceId in all requests** | `trustid.service.ts` | Correct: `ensureSession()` gates every API call |
| **Guest link creation** | `trustid.service.ts:createGuestLink()` | Correct: full request body including `ContainerEventCallbackUrl`, `ContainerEventCallbackHeaders`, `ClientApplicationReference`, `SendEmail`, `DigitalIdentityScheme` |
| **Branch retrieval** | `trustid.service.ts:getBranches()` | Correct: POST `/VPE/session/branches/` |
| **Flexible fields retrieval** | `trustid.service.ts:getApplicationFlexibleFields()` | Correct: POST `/VPE/session/applicationFlexibleFields/` |
| **Container retrieval** | `trustid.service.ts:retrieveDocumentContainer()` | Correct: POST `/VPE/dataAccess/retrieveDocumentContainer/` |
| **Image retrieval** | `trustid.service.ts:retrieveImage()` | Correct: POST `/VPE/dataAccess/retrieveImage/` with `arraybuffer` response |
| **PDF export** | `trustid.service.ts:exportPdf()` | Correct: POST `/VPE/dataAccess/exportPDF/` with `arraybuffer` response |
| **Webhook payload parsing** | `trustid-container.handler.ts` | Correct: `extractContainerId()` uses `Callback.WorkflowStorage[]` (primary) and `Response.ContainerId` (fallback) |
| **Container Submitted handler** | `trustid-container.handler.ts` | Correct: `WorkflowState="Start"` → updates token to `submitted` |
| **Result Notification handler** | `trustid-result.handler.ts` | Correct: validation + token lookup, passes to processor |
| **BullMQ processor** | `trustid-webhook.processor.ts` | Correct: async document pull → S3 upload → approve token |
| **DLQ handling** | `trustid-webhook.processor.ts:onFailed()` | Correct: exhausted jobs moved to DLQ after max retries |
| **OTel tracing** | `trustid-webhook.processor.ts:process()` | Correct: spans per job with containerId, attempt count attributes |
| **QR code generation** | `trustid.controller.ts` | Correct: `qrcode.toDataURL()` in guest-link response |
| **Webhook routing** | `trustid-webhook.controller.ts` | Correct: switch on `WorkflowState` ("Start" → inline, "Stop" → BullMQ) |

---

## ⚠️ Gaps & Issues Found

### 1. Missing: "Container Modified Post Result" webhook type

**Documentation:** A third webhook type exists with `WorkflowName="UpdateDocument"` (not `"AutoReferral"`) and `WorkflowState="Start"`. This fires when a container document is updated/modified AFTER the result was already published.

**Our code:** `trustid-webhook.controller.ts` routes ALL webhooks to the same endpoint and matches on `WorkflowState`. The `"Start"` case would fire for this webhook too, triggering `TrustIdContainerHandler` which would set status to `"submitted"` — incorrect for a post-result update.

**Fix:** Route on `WorkflowName` FIRST, then `WorkflowState`:
- `"AutoReferral"` + `"Start"` → Container Submitted (current behavior)
- `"AutoReferral"` + `"Stop"` → Result Notification (current behavior)
- `"UpdateDocument"` + `"Start"` → Post-Result Update (NEW — log + optional re-pull)

### 2. Missing: DBS Status Code Interpretation

**Documentation:** Detailed DBS status codes with TrustID interpretation:
| Code | Meaning | TrustID Interpretation |
|------|---------|----------------------|
| `FORM_READY` | Submitted by applicant | DBS Check Initiated |
| `FORM_COMPLETE` | Ready for RB to countersign | DBS Check In Progress |
| `FORM_AUTHORISED` | Countersigned | DBS Check In Progress |
| `APP_SENT` | Sent to DBS | DBS Check In Progress |
| `FORM_INVALID` | Form Invalid | DBS Check In Progress |
| `APP_RECEIVED` | Received by checking authority | DBS Check In Progress |
| `APP_REJECTED` | Rejected by checking authority | DBS Check Rejected |
| `APP_COMPLETE` | Completed | DBS Check Complete |
| `APP_WITHDRAWN` | Withdrawn | DBS Check Withdrawn |
| `AWAITING_DIGITAL_ID` | Awaiting Digital ID | DBS Check In Progress |

**Our code:** No DBS status interpretation. The container retrieval returns raw `Status` field but we don't map it to TrustID's interpretation.

**Impact:** Our token statuses (`pending` → `submitted` → `approved`/`denied`) don't map to DBS statuses. The `"Stop"` webhook could arrive while the DBS check is still `APP_RECEIVED` (in progress).

### 3. Missing: Document Assessment Feedback Properties

**Documentation:** TrustID provides detailed assessment feedback:
- `Document.DocumentResultsSummary` — top-level validation rules
- `Document.GeneralDocumentProperties` — expiry, DOB checks
- `Document.FeedbackFeatures` — manual operator verification steps
- `Document.MissingFieldsProperties` — mandatory fields missing
- `Document.MrzValidationProperties` — MRZ validation

**Our code:** `retrieveDocumentContainer()` returns raw `Container` data but we don't extract or store these feedback fields. The processor just uploads document images to S3 as blobs — the assessment data is lost.

### 4. Missing: RTRAgentName and RTWCompanyName Parameters

**Documentation:**
- `RTRAgentName` — required for Right to Rent (DigitalIdentityScheme=1) with RTR share code
- `RTWCompanyName` — optional for Right to Work with custom company name on share code

**Our code:** `CreateGuestLinkParams` interface and `CreateGuestLinkDto` don't include these fields.

### 5. Missing: DigitalIdentityScheme Value Documentation/Validation

**Documentation:** Digital identity schemes:
- `1` = Right To Rent (RTR)
- `2` = Right To Work (RTW)

**Our code:** Passes `digitalIdentityScheme` through as a raw number but doesn't validate against valid enum values. No constant/enum defined.

### 6. Missing: Post-Result Container Update Handling

**Documentation:** The post-result webhook includes `WorkflowStorage` with:
- `ContainerId`
- `DocumentId` (populated — identifies which document was updated)
- `ClientApplicationReference`

**Our code:** The `"Start"` handler doesn't account for `DocumentId` being populated. If a post-result update webhook fires, we'd incorrectly set status back to `"submitted"` (see issue #1).

### 7. Minor: ClientApplicationReference Default

**Documentation:** `ClientApplicationReference` is optional.

**Our code:** Defaults to empty string `''` in `createGuestLink()`. This is harmless but could confuse TrustID (empty string vs null). Should default to `undefined` (omit from body) per API expectations.

### 8. Minor: Login Response Has More Fields

**Documentation:** The login response includes "additional information" referenced in `Login Response` section.

**Our code:** Only extracts `SessionId`. No issue for core functionality but could miss useful metadata (e.g., password expiry warnings, permissions).

### 9. Minor: Typo in Docs

The documentation shows `"ContainerEventCallbackHeaders"::[` (double colon) — this is a documentation typo. Our implementation uses single colon correctly.

---

## Existing Implementation: Architecture Summary

```
┌─────────────────────┐
│  TrustIdController   │  POST /trustid/guest-link, GET /branches, /fields, /container/:id, etc.
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  TrustIdService      │  API client: login, createGuestLink, retrieveContainer, retrieveImage, exportPdf
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  TrustService        │  Token lifecycle: generate → validate → approve/deny. Integrates TrustIdService.
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  TrustRepository     │  Persistence: token CRUD, findByResourceId, findByTokenHash, updateStatus
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  Webhook Flow                                           │
│                                                         │
│  POST /api/v1/webhooks/trustid                          │
│  → TrustIdWebhookController                             │
│    → Start: TrustIdContainerHandler (inline, fire/forget)│
│    → Stop:  BullMQ → TrustIdWebhookProcessor            │
│              → pull docs from TrustID                   │
│              → upload to S3                             │
│              → approve token                            │
│              → DLQ on exhaustion                        │
└─────────────────────────────────────────────────────────┘
```

---

## Recommended Actions (Priority Order)

### P0 — Bug: Post-Result webhook misrouting
- [ ] Fix `trustid-webhook.controller.ts` to route by BOTH `WorkflowName` AND `WorkflowState`
- [ ] Add distinct handler for `UpdateDocument` + `Start` (or log + skip)

### P1 — Missing DTO fields
- [ ] Add `rtraAgentName?: string` and `rtwCompanyName?: string` to `CreateGuestLinkParams` and `CreateGuestLinkDto`
- [ ] Plumb them through `createGuestLink()` body
- [ ] Add `DigitalIdentityScheme` enum/constants

### P2 — Results interpretation
- [ ] Add DBS status code mapping (enum + interpretation strings)
- [ ] Expose document assessment feedback in container retrieval response
- [ ] Consider mapping DBS statuses to token status transitions

### P3 — ClientApplicationReference default
- [ ] Change default from `''` to undefined (omit when not provided)

### P4 — Document feedback storage
- [ ] In the processor, extract and store assessment feedback metadata alongside S3 blobs
- [ ] Store as JSON metadata in the trust token or as a separate S3 metadata file

---

## Files That Would Be Modified

| File | Change |
|------|--------|
| `apps/api/src/webhooks/trustid-webhook.controller.ts` | Route by WorkflowName+WorkflowState |
| `apps/api/src/trustid/trustid.service.ts` | Add RTRAgentName/RTWCompanyName to params; fix ClientApplicationReference default |
| `apps/api/src/trustid/dto/create-guest-link.dto.ts` | Add new optional fields |
| `apps/api/src/trustid/trustid.controller.ts` | Pass through new fields; add DBS status interpretation in container response |
| `apps/api/src/webhooks/handlers/trustid-container.handler.ts` | Don't set status to 'submitted' for post-result webhooks |
| `apps/api/src/webhooks/trustid-webhook.processor.ts` | Extract/store assessment feedback metadata |
| `apps/api/src/trustid/trustid.service.ts` (new constants) | Add DigitalIdentityScheme enum, DBS status codes |
| `plans/trustid-bullmq-s3-pull.md` | Updated to reflect new gap closure |

## Verification

1. **Unit tests:** Add test cases for post-result webhook routing
2. **Integration:** Simulate all three webhook types via curl
3. **DTO validation:** Test guest link creation with RTRAgentName/RTWCompanyName
4. **Results:** Verify DBS status codes appear in container retrieval response
