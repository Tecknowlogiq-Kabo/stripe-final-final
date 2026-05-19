const API_URL =
  typeof window === 'undefined'
    ? (process.env.API_URL ?? 'http://localhost:3001')
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001');

/**
 * Generates a UUID v4 for idempotency keys.
 * Each mutation request gets a unique key; retries reuse the same key
 * via the idempotencyKey parameter.
 */
function generateIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly stripeRequestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Builds Cookie header from httpOnly cookies (server-side only).
 * Uses a dynamic import so this module stays importable in Client Components —
 * `next/headers` is only resolved at runtime when actually running on the server.
 */
async function getCookieHeader(): Promise<Record<string, string>> {
  if (typeof window !== 'undefined') return {}; // browser: credentials:include handles cookies
  try {
    const { cookies } = await import('next/headers');
    const jar = cookies();
    const authToken = jar.get('auth_token')?.value;
    const refreshToken = jar.get('refresh_token')?.value;
    const parts: string[] = [];
    if (authToken) parts.push(`auth_token=${authToken}`);
    if (refreshToken) parts.push(`refresh_token=${refreshToken}`);
    return parts.length ? { Cookie: parts.join('; ') } : {};
  } catch {
    return {};
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  idempotencyKey?: string,
): Promise<T> {
  const cookieHeader = await getCookieHeader();
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...cookieHeader,
    ...(options.headers as Record<string, string> | undefined),
  };

  // Auto-generate idempotency key for mutating requests.
  // Prevents double-charges from network retries, browser double-clicks, etc.
  // The backend deduplicates by idempotency key.
  if (idempotencyKey) {
    baseHeaders['Idempotency-Key'] = idempotencyKey;
  }

  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...options,
    credentials: 'include',
    headers: baseHeaders,
    cache: 'no-store',
  });

  if (response.status === 401) {
    // Attempt silent token refresh then retry once
    const refreshed = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...cookieHeader },
    });

    if (refreshed.ok) {
      const retried = await fetch(`${API_URL}/api/v1${path}`, {
        ...options,
        credentials: 'include',
        headers: { ...baseHeaders, ...(await getCookieHeader()) },
        cache: 'no-store',
      });

      if (!retried.ok) {
        const err = await retried.json().catch(() => ({ message: 'Unknown error' }));
        throw new ApiError(
          err.message ?? 'Request failed',
          retried.status,
          err.stripeRequestId,
        );
      }

      return retried.json() as Promise<T>;
    }

    // Refresh failed — session expired
    throw new ApiError('Session expired', 401);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new ApiError(
      error.message ?? 'Request failed',
      response.status,
      error.stripeRequestId,
    );
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string, headers?: Record<string, string>) =>
    request<T>(path, { method: 'GET', headers }),

  /** Generates an idempotency key automatically to prevent double-charges. */
  post: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    }, generateIdempotencyKey()),

  /** Generates an idempotency key automatically. */
  patch: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers,
    }, generateIdempotencyKey()),

  /** Generates an idempotency key automatically. */
  delete: <T>(path: string, headers?: Record<string, string>) =>
    request<T>(path, { method: 'DELETE', headers }, generateIdempotencyKey()),
};
