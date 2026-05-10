'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
export type { AuthResult } from '@/features/auth/auth.types';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

/**
 * Revokes the refresh token server-side, deletes both auth cookies from the
 * browser via Set-Cookie headers, then redirects to /auth/login.
 */
export async function logoutAction(): Promise<void> {
  const jar = cookies();
  const refreshToken = jar.get('refresh_token')?.value;

  if (refreshToken) {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    }).catch(() => {});
  }

  jar.delete('auth_token');
  jar.delete('refresh_token');
  redirect('/auth/login');
}
