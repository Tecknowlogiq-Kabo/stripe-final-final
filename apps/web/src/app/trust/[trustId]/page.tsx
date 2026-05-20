'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface TrustState {
  valid: boolean;
  resourceType?: string;
  resourceId?: string;
  message?: string;
  loading: boolean;
  actionTaken?: boolean;
  actionResult?: string;
}

export default function TrustPage() {
  const params = useParams();
  const trustId = params.trustId as string;

  const [state, setState] = useState<TrustState>({ loading: true, valid: false });

  useEffect(() => {
    async function validate() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
        const res = await fetch(`${apiBase}/trust/${encodeURIComponent(trustId)}`);
        const data = await res.json();
        setState((prev) => ({
          ...prev,
          loading: false,
          valid: data.valid ?? false,
          resourceType: data.resourceType,
          resourceId: data.resourceId,
        }));
      } catch {
        setState((prev) => ({ ...prev, loading: false, valid: false, message: 'Failed to validate token' }));
      }
    }
    validate();
  }, [trustId]);

  const handleApprove = async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiBase}/trust/${encodeURIComponent(trustId)}/approve`, {
        method: 'POST',
      });
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        loading: false,
        actionTaken: true,
        actionResult: data.approved ? 'approved' : 'failed',
        message: data.approved ? undefined : data.message,
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        loading: false,
        actionTaken: true,
        actionResult: 'failed',
        message: 'Network error. Please try again.',
      }));
    }
  };

  const handleDeny = async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiBase}/trust/${encodeURIComponent(trustId)}/deny`, {
        method: 'POST',
      });
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        loading: false,
        actionTaken: true,
        actionResult: data.denied ? 'denied' : 'failed',
        message: data.denied ? undefined : data.message,
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        loading: false,
        actionTaken: true,
        actionResult: 'failed',
        message: 'Network error. Please try again.',
      }));
    }
  };

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

  if (state.actionTaken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="card max-w-md w-full text-center">
          <div className="mb-6">
            {state.actionResult === 'approved' ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-green-400 mx-auto mb-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : state.actionResult === 'denied' ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-red-400 mx-auto mb-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-yellow-400 mx-auto mb-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            )}
          </div>
          <h1 className="text-2xl font-semibold text-zinc-100 mb-2">
            {state.actionResult === 'approved'
              ? 'Approved'
              : state.actionResult === 'denied'
                ? 'Denied'
                : 'Error'}
          </h1>
          <p className="text-sm text-zinc-400 mb-6">
            {state.actionResult === 'approved'
              ? 'Files are being transferred to secure storage.'
              : state.actionResult === 'denied'
                ? 'Access has been denied.'
                : state.message ?? 'Something went wrong.'}
          </p>
          <p className="text-xs text-zinc-600">You can close this page now.</p>
        </div>
      </div>
    );
  }

  if (!state.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="card max-w-md w-full text-center">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-red-400 mx-auto mb-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <h1 className="text-xl font-semibold text-zinc-100 mb-2">Invalid or Expired Link</h1>
          <p className="text-sm text-zinc-400">
            {state.message ?? 'This trust link is no longer valid. It may have expired or already been used.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="card max-w-md w-full">
        <h1 className="text-xl font-semibold text-zinc-100 mb-4">Trust Access Request</h1>

        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Resource Type</span>
            <span className="text-zinc-300 font-medium">{state.resourceType ?? 'Unknown'}</span>
          </div>
          {state.resourceId && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Resource ID</span>
              <span className="text-zinc-300 font-mono text-xs">{state.resourceId}</span>
            </div>
          )}
        </div>

        <p className="text-sm text-zinc-400 mb-6">
          Do you want to approve access to this resource? Approving will transfer files to secure storage.
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleApprove}
            disabled={state.loading}
            className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {state.loading ? 'Processing...' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={handleDeny}
            disabled={state.loading}
            className="flex-1 px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 text-zinc-200 text-sm font-medium rounded-lg transition-colors"
          >
            {state.loading ? 'Processing...' : 'Deny'}
          </button>
        </div>
      </div>
    </div>
  );
}
