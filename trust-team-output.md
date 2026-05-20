# Team B — TrustId System — DONE

## Files Created

### API (NestJS)
- `apps/api/src/entities/trust-token.entity.ts` — TypeORM entity for TRUST_TOKENS (Oracle)
- `apps/api/src/trust/trust.repository.ts` — Raw SQL repository (DataSource injection pattern)
- `apps/api/src/trust/trust.service.ts` — JWT signing, SHA-256 hashing, validate/approve/deny
- `apps/api/src/trust/trust.guard.ts` — CanActivate guard (query param or X-Trust-Id header)
- `apps/api/src/trust/trust.controller.ts` — 5 endpoints: POST /tokens, GET/:token, POST/:token/approve, POST/:token/deny, GET/:token/guest-link
- `apps/api/src/trust/dto/create-trust-token.dto.ts` — class-validator DTO
- `apps/api/src/trust/dto/approve-trust.dto.ts` — class-validator DTO
- `apps/api/src/trust/trust.module.ts` — NestJS module with JwtModule.registerAsync

### Web (Next.js)
- `apps/web/src/app/trust/[trustId]/page.tsx` — Guest-facing approve/deny page with full state machine (loading/error/pending/approved/denied/already_processed)

### Modified
- `apps/web/src/middleware.ts` — Added `/trust/` as public path bypass

## Key Design Decisions
1. **Token = JWT**: trustId is a signed JWT with sub, resourceType, resourceId, exp, iat
2. **Hash for DB**: SHA-256(token) stored in TRUST_TOKENS for lookup; JWT itself is the trustId
3. **Guest link**: `{TRUST_GUEST_LINK_BASE_URL}/trust/{encoded_jwt}`
4. **Audit**: Fire-and-forget via AuditService.log() on approve/deny
5. **Cache**: Redis cache for validation results (5min TTL), invalidated on approve/deny
6. **Expiry**: Belt-and-suspenders — JWT exp + DB EXPIRES_AT + stale batch expire

## Remaining for Integration
- TrustModule and TrustController need to be imported in `app.module.ts`
- TrustController needs the `@Public()` routes added to web middleware's public path list (done)
- Need to wire S3 approval trigger in Phase 4 (Team C will hook into `trust.approved` audit -> S3 pull)
