import type { AuthInput, AuthResult } from './auth.types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

class AuthService {
  private async call(endpoint: string, input: AuthInput): Promise<AuthResult> {
    const res = await fetch(`${API_URL}/api/v1/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? 'Auth failed');
    }

    return res.json() as Promise<AuthResult>;
  }

  login(input: AuthInput): Promise<AuthResult> {
    return this.call('login', input);
  }

  register(input: AuthInput): Promise<AuthResult> {
    return this.call('register', input);
  }
}

export const authService = new AuthService();
