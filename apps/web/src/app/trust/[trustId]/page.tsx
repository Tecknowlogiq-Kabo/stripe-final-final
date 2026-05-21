'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';

type TrustStatus = 'pending' | 'submitted' | 'approved' | 'denied' | 'expired' | 'invalid';
type ViewMode = 'iframe' | 'qrcode';

interface TrustState {
  status: TrustStatus;
  resourceType?: string;
  resourceId?: string;
  tokenId?: string;
  expiresAt?: string;
  guestLink?: string;
  qrCodeDataUrl?: string;
  loading: boolean;
  error?: string;
}

const POLL_INTERVAL_MS = 5_000;

export default function TrustPage() {
  const params = useParams();
  const trustId = params.trustId as string;

  const [state, setState] = useState<TrustState>({ loading: true, status: 'invalid' });
  const [viewMode, setViewMode] = useState<ViewMode>('iframe');

  // Fetch the guest link on mount
  const fetchGuestLink = useCallback(async () => {
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiBase}/trust/${encodeURIComponent(trustId)}/guest-link`);
      const data = await res.json();

      if (data.valid && data.guestLink) {
        setState((prev) => ({
          ...prev,
          guestLink: data.guestLink,
          qrCodeDataUrl: data.qrCodeDataUrl ?? null,
        }));
      }
    } catch {
      // Non-fatal — guest link fetch is best-effort
    }
  }, [trustId]);

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
          setState((prev) => ({
            ...prev,
            loading: false,
            status: data.status,
            resourceType: data.resourceType,
            resourceId: data.resourceId,
            tokenId: data.tokenId,
            expiresAt: data.expiresAt,
          }));
          return;
        }

        // Still pending — keep polling
        setState((prev) => ({
          ...prev,
          loading: false,
          status: 'pending',
          resourceType: data.resourceType,
          resourceId: data.resourceId,
          tokenId: data.tokenId,
          expiresAt: data.expiresAt,
        }));
      } catch {
        if (!mounted) return;
        setState({ loading: false, status: 'invalid', error: 'Unable to reach the server' });
        clearInterval(pollTimer);
      }
    }

    fetchGuestLink();
    checkStatus();
    pollTimer = setInterval(checkStatus, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(pollTimer);
    };
  }, [trustId, fetchGuestLink]);

  // ---- Loading skeleton ----
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

  // ---- Submitted state ----
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

  // ---- Approved state ----
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

  // ---- Denied state ----
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

  // ---- Invalid / Expired state ----
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

  // ---- Pending — show iframe + QR code if guest link is available ----
  const hasTrustIdGuestLink = state.guestLink && !state.guestLink.includes(`/trust/${trustId}`);

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse shrink-0" />
          <h1 className="text-lg font-semibold text-zinc-100">Identity Verification</h1>
        </div>
        <span className="text-xs text-zinc-500">
          {state.expiresAt ? `Expires ${new Date(state.expiresAt).toLocaleString()}` : ''}
        </span>
      </div>

      {/* Main content */}
      {hasTrustIdGuestLink ? (
        <>
          {/* Tab bar */}
          <div className="flex border-b border-zinc-800 px-6">
            <button
              onClick={() => setViewMode('iframe')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                viewMode === 'iframe'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Upload Documents
            </button>
            <button
              onClick={() => setViewMode('qrcode')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                viewMode === 'qrcode'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Scan QR Code
            </button>
          </div>

          {/* Content area */}
          <div className="flex-1">
            {viewMode === 'iframe' ? (
              <iframe
                src={state.guestLink}
                className="w-full h-full min-h-[calc(100vh-120px)] border-0"
                title="TrustID Identity Verification"
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                allow="camera;microphone;geolocation"
                loading="eager"
              />
            ) : state.qrCodeDataUrl ? (
              <div className="flex flex-col items-center justify-center py-12 px-6">
                <div className="card max-w-sm w-full text-center">
                  <h2 className="text-lg font-semibold text-zinc-100 mb-2">Scan to Upload</h2>
                  <p className="text-sm text-zinc-400 mb-6">
                    Scan this QR code with your mobile device to upload your documents.
                  </p>
                  <div className="bg-white p-4 rounded-xl inline-block mb-6">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={state.qrCodeDataUrl}
                      alt="QR code for document upload"
                      className="w-64 h-64"
                    />
                  </div>
                  <a
                    href={state.guestLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:text-blue-300 underline"
                  >
                    Or open link in new tab
                  </a>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-zinc-500">QR code not available</p>
              </div>
            )}
          </div>
        </>
      ) : (
        /* No TrustID guest link — legacy pending view */
        <div className="flex-1 flex items-center justify-center px-6">
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

            {state.guestLink && (
              <a
                href={state.guestLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block text-sm text-blue-400 hover:text-blue-300 underline"
              >
                Open link in new tab
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
