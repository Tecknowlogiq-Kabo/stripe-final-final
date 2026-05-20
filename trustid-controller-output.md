# Team C — TrustID Controller + Frontend: Complete ✅

## Files Created

| File | Description |
|------|-------------|
| `apps/api/src/trustid/trustid.controller.ts` | TrustID REST API controller — 6 endpoints |
| `apps/api/src/trustid/trustid.service.ts` | TrustID Cloud API client (real implementation with HttpService) |
| `apps/api/src/trustid/trustid.module.ts` | @Global module with HttpModule + TrustModule forwardRef |
| `apps/api/src/trustid/dto/create-guest-link.dto.ts` | DTO for guest link creation (email, name, branchId, flexible fields, etc.) |

## Files Updated

| File | Changes |
|------|---------|
| `apps/api/src/trust/trust.module.ts` | Removed unused forwardRef import; simplified imports |
| `apps/api/src/trust/trust.service.ts` | Added `linkContainerId()` method (+ 'submitted' status handling). Updated validate/approve/deny to accept 'submitted' status. |
| `apps/api/src/trust/trust.repository.ts` | Added `updateMetadata()` method |
| `apps/api/src/trust/dto/create-trust-token.dto.ts` | Added optional TrustID fields: email, name, branchId, clientApplicationReference, applicationFlexibleFieldValues |
| `apps/api/src/entities/trust-token.entity.ts` | Added 'submitted' to TrustTokenStatus |
| `apps/api/src/config/configuration.ts` | Added `trustid:` config block (apiBaseUrl, apiKey, username, password, deviceId, defaultBranchId) |
| `apps/api/.env.example` | Added TrustID Cloud env vars |
| `apps/api/src/app.module.ts` | Imported TrustIdModule |
| `apps/api/src/webhooks/handlers/trustid-result.handler.ts` | Fixed API calls: retrieveImage -> {data, contentType}, exportPDF, s3 upload |
| `apps/web/src/app/trust/[trustId]/page.tsx` | Added 'submitted' status with blue pulsing state |

## TrustID Controller Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/trustid/guest-link` | JWT | Create TrustID guest link + linked trust token |
| GET | `/trustid/branches` | JWT | List available branches |
| GET | `/trustid/fields?branchId=x` | JWT | List custom fields for branch |
| GET | `/trustid/container/:id` | JWT | Retrieve document container |
| GET | `/trustid/document/:imageId` | JWT | Retrieve image as binary (piped via @Res) |
| GET | `/trustid/report/:containerId/pdf` | JWT | Generate/stream PDF report |

## Trust Token Status Flow

```
pending → submitted → approved/denied
         (TrustID webhook)   (TrustID webhook or explicit)
```

## Verification

- TypeScript: compiles clean (`npx tsc --noEmit` — 0 errors)
- Tests: 12 suites, 75 tests, all passing
- Circular dependency: resolved via @Global() on TrustIdModule + forwardRef in TrustIdModule → TrustModule
