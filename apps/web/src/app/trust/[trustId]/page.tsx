'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

type TrustStatus = 'pending' | 'submitted' | 'approved' | 'denied' | 'expired' | 'invalid';

interface TrustState {
  status: TrustStatus;
  resourceType?: string;
  resourceId?: string;
  tokenId?: string;
  expiresAt?: string;
  loading: boolean;
  error?: string;
}

const POLL_INTERVAL_MS = 5_000;

export default function TrustPage() {
  const params = useParams();
  const trustId = params.trustId as string;

  const [state, setState] = useState<TrustState>({ loading: true, status: 'invalid' });

  useEffect(() => {
    let mounted = true;
    let pollTimer: ReturnType<typeof setInterval>;

    async function checkStatus() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
        const res = await fetch(`${apiBase}/trust/${encodeURIComponent(trustId)}`);
        const data = await res.json();

        if (!mounted) return;

        if (!data.valid) {
          setState({ loading: false, status: 'invalid', error: 'Token is invalid or expired' });
          clearInterval(pollTimer);
          return;
        }

        if (data.status === 'approved' || data.status === 'denied' || data.status === 'expired' || data.status === 'submitted') {
          // Terminal state — stop polling
          clearInterval(pollTimer);
          setState({
            loading: false,
            status: data.status,
            resourceType: data.resourceType,
            resourceId: data.resourceId,
            tokenId: data.tokenId,
            expiresAt: data.expiresAt,
          });
          return;
        }

        // Still pending — keep polling
        setState({
          loading: false,
          status: 'pending',
          resourceType: data.resourceType,
          resourceId: data.resourceId,
          tokenId: data.tokenId,
          expiresAt: data.expiresAt,
        });
      } catch {
        if (!mounted) return;
        setState({ loading: false, status: 'invalid', error: 'Unable to reach the server' });
        clearInterval(pollTimer);
      }
    }

    checkStatus();
    pollTimer = setInterval(checkStatus, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(pollTimer);
    };
  }, [trustId]);

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="card max-w-md w-full text-center">
          <div className="animate-pulse">
            <div className="h-6 bg-zinc-800 rounded w-1/3 mx-auto mb-4" />
            <div className="h-4 bg-zinc-800 rounded w-2/3 mx-auto" />
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'submitted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="card max-w-md w-full">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
            <h1 className="text-xl font-semibold text-zinc-100">Documents Submitted</h1>
          </div>

          <div className="mb-6 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Resource Type</span>
              <span className="text-zinc-300 font-medium">{state.resourceType ?? '—'}</span>
            </div>
            {state.resourceId && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Resource ID</span>
                <span className="text-zinc-300 font-mono text-xs">{state.resourceId}</span>
              </div>
            )}
            {state.expiresAt && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Expires</span>
                <span className="text-zinc-300 text-xs">{new Date(state.expiresAt).toLocaleString()}</span>
              </div>
            )}
          </div>

          <p className="text-sm text-zinc-400">
            Documents have been submitted and are being verified. This page will update when verification is complete.
          </p>
        </div>
      </div>
    );
  }

  if (state.status === 'approved') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="card max-w-md w-full text-center">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-green-400 mx-auto mb-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h1 className="text-2xl font-semibold text-zinc-100 mb-2">Approved</h1>
          <p className="text-sm text-zinc-400 mb-4">Documents verified and stored securely.</p>
          <p className="text-xs text-zinc-600">You can close this page.</p>
        </div>
      </div>
    );
  }

  if (state.status === 'denied') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="card max-w-md w-full text-center">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-red-400 mx-auto mb-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          <h1 className="text-2xl font-semibold text-zinc-100 mb-2">Denied</h1>
          <p className="text-sm text-zinc-400 mb-4">Access has been denied.</p>
          <p className="text-xs text-zinc-600">You can close this page.</p>
        </div>
      </div>
    );
  }

  if (state.status === 'invalid' || state.status === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="card max-w-md w-full text-center">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-red-400 mx-auto mb-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <h1 className="text-xl font-semibold text-zinc-100 mb-2">Link {state.status === 'expired' ? 'Expired' : 'Invalid'}</h1>
          <p className="text-sm text-zinc-400">
            {state.error ?? 'This trust link is no longer valid. It may have expired or already been acted upon.'}
          </p>
        </div>
      </div>
    );
  }

  // Pending — show status, no action buttons
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="card max-w-md w-full">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse shrink-0" />
          <h1 className="text-xl font-semibold text-zinc-100">Awaiting Approval</h1>
        </div>

        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Resource Type</span>
            <span className="text-zinc-300 font-medium">{state.resourceType ?? '—'}</span>
          </div>
          {state.resourceId && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Resource ID</span>
              <span className="text-zinc-300 font-mono text-xs">{state.resourceId}</span>
            </div>
          )}
          {state.expiresAt && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Expires</span>
              <span className="text-zinc-300 text-xs">{new Date(state.expiresAt).toLocaleString()}</span>
            </div>
          )}
        </div>

        <p className="text-sm text-zinc-400">
          This request is pending approval. Processing is handled automatically through webhooks.
          You can refresh or wait — the page will update when status changes.
        </p>
      </div>
    </div>
  );
}
