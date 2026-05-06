'use server';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface AuthInput {
  email: string;
  password: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

/**
 * Login and register are handled client-side (direct fetch with credentials: 'include')
 * so the browser receives the backend's Set-Cookie headers directly.
 *
 * These Server Action wrappers remain available for any server-side code that needs them.
 */
async function callAuth(endpoint: string, input: AuthInput): Promise<AuthResult> {
  const response = await fetch(`${API_URL}/api/v1/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? 'Auth failed');
  }

  return response.json();
}

export async function loginAction(input: AuthInput): Promise<AuthResult> {
  return callAuth('login', input);
}

export async function registerAction(input: AuthInput): Promise<AuthResult> {
  return callAuth('register', input);
}

export async function logoutAction(): Promise<void> {
  await fetch(`${API_URL}/api/v1/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {});
}
