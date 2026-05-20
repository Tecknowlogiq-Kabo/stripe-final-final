# Team C — S3 Module + TrustId→S3 Integration — Output

## Status: COMPLETE ✅

## Files Created

| File | Description |
|------|-------------|
| `apps/api/src/s3/s3.service.ts` | S3Service wrapping `@aws-sdk/client-s3` with 8 methods |
| `apps/api/src/s3/s3.module.ts` | NestJS module, exports S3Service |
| `apps/api/src/s3/s3.service.spec.ts` | 19 unit tests (all passing) |

## Files Modified

| File | Change |
|------|--------|
| `apps/api/src/app.module.ts` | Added imports for `S3Module` and `TrustModule` |

## Dependencies Installed

- `@aws-sdk/client-s3` (47 packages)
- `@aws-sdk/s3-request-presigner`

## S3Service API Surface

| Method | Signature | Description |
|--------|-----------|-------------|
| `upload` | `(key, body, contentType?) → {key, etag?}` | Upload Buffer/string to S3 |
| `download` | `(key) → Buffer` | Download from S3, throws NotFoundException |
| `presignedGetUrl` | `(key, expiresIn?) → string` | Time-limited read URL (default 1h) |
| `presignedPutUrl` | `(key, expiresIn?, contentType?) → string` | Time-limited write URL |
| `deleteObject` | `(key) → void` | Delete from S3, idempotent |
| `objectExists` | `(key) → boolean` | Check existence via HeadObject |
| `pullAndStore` | `(sourceUrl, destKey, contentType?) → {key, size}` | Fetch from URL → store in S3 |

## Test Results

```
Tests: 19 passed, 19 total
- upload: 4 tests (Buffer, string→Buffer, contentType, error)
- download: 3 tests (success, NotFoundException, rethrow)
- presignedGetUrl: 2 tests (custom expiry, default expiry)
- presignedPutUrl: 1 test
- deleteObject: 2 tests (success, error)
- objectExists: 3 tests (exists, not found, rethrow)
- pullAndStore: 4 tests (success, explicit contentType, fetch failure, non-2xx)
```

## Integration Notes for Team B (Trust)

The `S3Module` is wired into `AppModule` and exports `S3Service`. Team B should:

1. Import `S3Module` in `TrustModule` (or rely on AppModule's import)
2. Inject `S3Service` into `TrustService`
3. In the `approve()` method, when resourceType is file-like:
```typescript
if (token.resourceType === 'file' && token.metadata?.sourceUrl) {
  const destKey = `${this.config.get('aws.s3TrustPrefix')}${token.resourceId}/${token.id}`;
  await this.s3Service.pullAndStore(token.metadata.sourceUrl, destKey);
}
```
4. `pullAndStore` uses native `fetch()` (Node 18+) — no extra deps needed
