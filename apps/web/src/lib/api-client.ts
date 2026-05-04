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

/** Returns Authorization header value from httpOnly cookie (server-side only). */
function getAuthHeader(): Record<string, string> {
  try {
    const token = cookies().get('auth_token')?.value;
    return token ? { Authorization: `Bearer ${token}` } : {};
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
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
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
