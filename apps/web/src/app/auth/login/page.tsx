'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLogin } from '@/features/auth/auth.hooks';

export default function LoginPage() {
  const router = useRouter();
  const { mutate: login, isPending, error } = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login(
      { email, password },
      {
        onSuccess: () => {
          const redirectTo = new URLSearchParams(window.location.search).get('redirect') ?? '/';
          router.push(redirectTo);
        },
      },
    );
  };

  return (
    <div className="max-w-sm mx-auto mt-20">
      <div className="card">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Sign in</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600">{error.message}</p>
          )}
          <button type="submit" disabled={isPending} className="btn-primary w-full">
            {isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-sm text-center text-gray-500">
          No account?{' '}
          <a href="/auth/register" className="text-indigo-600 hover:underline">
            Register
          </a>
        </p>
      </div>
    </div>
  );
}
