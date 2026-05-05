const REDACTED = '[REDACTED]';

const SENSITIVE = new Set([
  'password', 'token', 'authorization', 'ssn', 'creditcard', 'secret',
  'apikey', 'api_key', 'refreshtoken', 'refresh_token',
  'stripesecretkey', 'stripe_secret_key', 'webhooksecret', 'webhook_secret',
  'jwtsecret', 'jwt_secret', 'databaseurl', 'database_url',
  'redisurl', 'redis_url', 'privatekey', 'private_key',
]);

export function sanitizeFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeFields(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function maskEmail(email: string): string {
  return email.replace(/(.{1,2})[^@]*(@.*)/, '$1***$2');
}

export function sanitizePath(url: string): string {
  // Strip query string and fragment to avoid logging sensitive params
  return url.split('?')[0].split('#')[0];
}
