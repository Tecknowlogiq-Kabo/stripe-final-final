'use server';

import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface AuthInput {
  email: string;
  password: string;
}

interface AuthResult {
  accessToken: string;
  user: { id: string; email: string };
}

async function callAuth(endpoint: string, input: AuthInput): Promise<AuthResult> {
  const response = await fetch(`${API_URL}/api/v1/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? `Auth failed`);
  }

  const result: AuthResult = await response.json();

  // Store in httpOnly cookie so server actions can forward it to the API
  cookies().set('auth_token', result.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 15, // 15 minutes — matches JWT expiry
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
  cookies().delete('auth_token');
}
