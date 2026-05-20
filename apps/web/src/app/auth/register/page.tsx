'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRegisterMutation } from '@/features/auth/auth-api-slice';
import { getErrorMessage } from '@/lib/rtk-errors';

export default function RegisterPage() {
  const router = useRouter();
  const [register, { isLoading, error }] = useRegisterMutation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await register({ email, password }).unwrap();
      const raw = new URLSearchParams(window.location.search).get('redirect') ?? '/';
      const redirectTo = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
      router.push(redirectTo);
    } catch {
      // error handled via `error` state
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-white">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight">Create account</h1>
          <p className="text-sm text-zinc-500 mt-1">Stripe Console</p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-400 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-zinc-400 mb-1.5">
                Password{' '}
                <span className="text-zinc-600 font-normal">(min 8 characters)</span>
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-field"
              />
            </div>
            {error && (
              <div role="alert" className="alert-error">
                {getErrorMessage(error)}
              </div>
            )}
            <button type="submit" disabled={isLoading} className="btn-primary w-full">
              {isLoading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          <p className="mt-5 text-sm text-center text-zinc-500">
            Already have an account?{' '}
            <a href="/auth/login" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
