'use server';

import { cookies } from 'next/headers';

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
    throw new Error(error.message ?? `Auth failed`);
  }

  const result: AuthResult = await response.json();
  const jar = cookies();

  jar.set('auth_token', result.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 15, // 15 minutes — matches JWT expiry
  });

  jar.set('refresh_token', result.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days — matches Redis TTL
  });

  return result;
}

export async function loginAction(input: AuthInput): Promise<AuthResult> {
  return callAuth('login', input);
}

export async function registerAction(input: AuthInput): Promise<AuthResult> {
  return callAuth('register', input);
}

export async function logoutAction(): Promise<void> {
  const jar = cookies();
  const refreshToken = jar.get('refresh_token')?.value;

  // Best-effort: revoke the refresh token server-side
  await fetch(`${API_URL}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(refreshToken ? { Cookie: `refresh_token=${refreshToken}` } : {}),
    },
    credentials: 'include',
  }).catch(() => {});

  jar.delete('auth_token');
  jar.delete('refresh_token');
}
