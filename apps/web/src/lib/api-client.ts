import { cookies } from 'next/headers';

const API_URL =
  typeof window === 'undefined'
    ? process.env.API_URL           // server-side: Docker internal URL
    : process.env.NEXT_PUBLIC_API_URL; // client-side: public URL

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

/** Builds Cookie header from httpOnly cookies (server-side only). */
function getCookieHeader(): Record<string, string> {
  try {
    const jar = cookies();
    const authToken = jar.get('auth_token')?.value;
    const refreshToken = jar.get('refresh_token')?.value;
    const parts: string[] = [];
    if (authToken) parts.push(`auth_token=${authToken}`);
    if (refreshToken) parts.push(`refresh_token=${refreshToken}`);
    return parts.length ? { Cookie: parts.join('; ') } : {};
  } catch {
    // cookies() throws outside of Server Component/Action context — safe to ignore
    return {};
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getCookieHeader(),
      ...options.headers,
    },
    cache: 'no-store',
  });

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

  post: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    }),

  patch: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers,
    }),

  delete: <T>(path: string, headers?: Record<string, string>) =>
    request<T>(path, { method: 'DELETE', headers }),
};
