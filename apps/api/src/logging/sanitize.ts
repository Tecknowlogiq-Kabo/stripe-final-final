const REDACTED = '[REDACTED]';

/**
 * PCI-DSS + PII sensitive field names.
 * Any key matching one of these (case-insensitive) is redacted.
 */
const SENSITIVE = new Set([
  // Secrets & tokens
  'password', 'token', 'secret', 'authorization',
  'apikey', 'api_key', 'refreshtoken', 'refresh_token',
  'stripesecretkey', 'stripe_secret_key', 'webhooksecret', 'webhook_secret',
  'jwtsecret', 'jwt_secret', 'privatekey', 'private_key',
  'databaseurl', 'database_url', 'redisurl', 'redis_url',
  // PCI-DSS (card data)
  'card', 'card_number', 'cardnumber', 'pan', 'cc', 'cc_number',
  'cvc', 'cvv', 'cvv2', 'security_code', 'cvc_check',
  'exp', 'expiry', 'expiration', 'exp_month', 'exp_year',
  // Bank account
  'bank_account', 'routing_number', 'account_number', 'iban', 'bic', 'sort_code',
  // PII (GDPR)
  'email', 'phone', 'address', 'name', 'first_name', 'last_name',
  'dob', 'date_of_birth', 'tax_id', 'ssn', 'ip', 'ip_address',
  'creditcard', 'credit_card', 'passport', 'drivers_license',
  // Stripe-sensitive
  'source', 'client_secret', 'payment_method', 'payment_method_id',
]);

export function sanitizeFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else if (Array.isArray(v)) {
      out[k] = v.map(item =>
        item !== null && typeof item === 'object'
          ? sanitizeFields(item as Record<string, unknown>)
          : item,
      );
    } else if (v !== null && typeof v === 'object') {
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
  return url.split('?')[0].split('#')[0];
}
