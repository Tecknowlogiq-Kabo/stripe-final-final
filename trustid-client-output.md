# Team A — TrustID API Client: COMPLETE

## Files Created
| File | Lines | Purpose |
|------|-------|---------|
| `apps/api/src/trustid/trustid.module.ts` | 14 | NestJS module: imports HttpModule, exports TrustIdService |
| `apps/api/src/trustid/trustid.service.ts` | 269 | Full TrustID Cloud API client (Workflow 4) |
| `apps/api/src/trustid/trustid.controller.ts` | 117 | REST endpoints: guest-link, branches, fields, container, image, PDF |
| `apps/api/src/trustid/dto/create-guest-link.dto.ts` | 75 | Validation DTO for guest link creation |

## Files Modified
| File | Change |
|------|--------|
| `apps/api/src/config/configuration.ts` | Added `trustid:` config block (apiBaseUrl, apiKey, username, password, sessionTtlSeconds, webhookCallbackBaseUrl) |
| `apps/api/src/config/validation.schema.ts` | Added TRUSTID_API_BASE_URL, TRUSTID_API_KEY, TRUSTID_USERNAME, TRUSTID_PASSWORD, TRUSTID_SESSION_TTL_SECONDS, TRUSTID_WEBHOOK_CALLBACK_BASE_URL |
| `apps/api/.env.example` | Updated TrustID Cloud block with correct field names |
| `apps/api/src/trust/trust.module.ts` | Imported TrustIdModule |
| `apps/api/src/trust/trust.service.ts` | Injected TrustIdService; generateTrustToken() now creates real TrustID guest links via `trustIdService.createGuestLink()` with local fallback |
| `apps/api/src/trust/trust.controller.ts` | Injected ConfigService; passes guest email/name/flexible fields through to TrustID |
| `apps/api/src/trust/dto/create-trust-token.dto.ts` | Added email, name, branchId, clientApplicationReference, applicationFlexibleFieldValues |
| `apps/api/src/app.module.ts` | Imported TrustIdModule + TrustIdWebhookModule |
| `apps/api/src/webhooks/handlers/trustid-result.handler.ts` | Fixed compilation errors: retrieveImage returns Buffer (not {data, contentType}), exportPdf/exportPDF aliased |
| `apps/api/src/trustid/trustid.controller.ts` | Rewritten for type consistency with service |

## TrustIdService API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `login()` | POST /VPE/session/login/ | Authenticate, get SessionId |
| `testConnection()` | POST /VPE/session/testConnection/ | Connectivity check (no auth) |
| `getBranches()` | POST /VPE/session/branches/ | List available branches |
| `getApplicationFlexibleFields(branchId)` | POST /VPE/session/applicationFlexibleFields/ | List custom fields |
| `createGuestLink(params)` | POST /VPE/guestLink/createGuestLink/ | Create guest link with callback URL |
| `retrieveDocumentContainer(containerId)` | POST /VPE/dataAccess/retrieveDocumentContainer/ | Get full app data |
| `retrieveImage(imageId)` | POST /VPE/dataAccess/retrieveImage/ | Get image as Buffer |
| `exportPdf(containerId)` | POST /VPE/dataAccess/exportPDF/ | Get PDF report as Buffer |

## Key Architecture Decisions

- **In-memory session cache** with 15-min TTL (`this.sessionData`). Auto-renews on 401.
- **Auto-branch discovery**: If no branchId provided, uses first available branch.
- **Callback URL**: `{webhookCallbackBaseUrl}/api/v1/webhooks/trustid` — this is where TrustID sends its webhooks
- **Local fallback**: If TrustID guest link creation fails, falls back to local `{baseUrl}/trust/{trustId}` link
- **ContainerId tracking**: Stored in token metadata as `trustidContainerId` for webhook-to-token mapping
- **Backward compat aliases**: `getFlexibleFields()` → `getApplicationFlexibleFields()`, `exportPDF()` → `exportPdf()`

## Verification
- TypeScript: 0 errors
- Tests: 12 suites, 75 tests, all passing
