'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMyCustomer } from '@/features/customers/customers.hooks';
import { useCustomerPaymentIntents } from '@/features/payment-intents/payment-intents.hooks';
import type { PaymentIntent } from '@/features/payment-intents/payment-intents.types';

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  const classMap: Record<string, string> = {
    succeeded: 'badge-green',
    processing: 'badge-blue',
    requires_payment_method: 'badge-yellow',
    requires_action: 'badge-orange',
    canceled: 'badge-red',
  };
  return (
    <span className={classMap[status] ?? 'badge-gray'}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function PaymentsPage() {
  const [page, setPage] = useState(1);
  const limit = 10;

  const { data: myCustomer } = useMyCustomer();
  const customerId = myCustomer?.id ?? '';

  const { data: response, isLoading, isError, isFetching, refetch } = useCustomerPaymentIntents(
    { customerId, page, limit },
  );

  const totalPages = response ? Math.ceil(response.total / response.limit) : 0;

  if (!customerId) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">Customer-owned payment intent history</p>
        </div>
        <div className="card text-center py-10 text-zinc-500 text-sm">
          <p>Payment history appears after you complete a checkout and create a customer profile.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/checkout" className="btn-primary">
              Make a payment
            </Link>
            <Link href="/" className="btn-ghost border border-zinc-700">
              Go to overview
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">Customer-owned payment intent history</p>
        </div>
        <Link href="/checkout" className="btn-primary">New Payment</Link>
      </div>

      {isError && (
        <div className="alert-error mb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Failed to load payments.</p>
              <p className="mt-1">Make sure the API is running and your session is still valid.</p>
            </div>
            <button
              onClick={() => void refetch()}
              className="shrink-0 text-sm font-semibold underline underline-offset-2 hover:opacity-80"
            >
              Check again
            </button>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {isLoading || isFetching ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse flex items-center gap-4 py-2">
                <div className="h-4 bg-zinc-800 rounded w-20" />
                <div className="h-4 bg-zinc-800 rounded w-16" />
                <div className="h-3 bg-zinc-800/60 rounded w-32 ml-auto" />
              </div>
            ))}
          </div>
        ) : !response || response.data.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 text-sm">
            No payments yet. Make a payment to see history and status tracking here.
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/checkout" className="btn-primary">
                Make a payment
              </Link>
              <Link href="/" className="btn-ghost border border-zinc-700">
                Go to overview
              </Link>
            </div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Status</th>
                <th>Description</th>
                <th>Receipt</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {response.data.map((pi: PaymentIntent) => (
                <tr key={pi.id}>
                  <td>
                    <span className="mono font-medium text-zinc-100">
                      {formatAmount(pi.amount, pi.currency)}
                    </span>
                    {pi.amountReceived != null && pi.amountReceived !== pi.amount && (
                      <span className="block text-xs text-zinc-500 mono">
                        rcv {formatAmount(pi.amountReceived, pi.currency)}
                      </span>
                    )}
                  </td>
                  <td><StatusBadge status={pi.status} /></td>
                  <td>
                    <span className="text-zinc-400 text-xs">{pi.description ?? '—'}</span>
                  </td>
                  <td>
                    <span className="text-zinc-500 text-xs">{pi.receiptEmail ?? '—'}</span>
                  </td>
                  <td>
                    <span className="mono text-xs text-zinc-500">{formatDate(pi.createdAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-ghost text-xs disabled:opacity-30"
            >
              ← Previous
            </button>
            <span className="text-xs text-zinc-500 mono">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn-ghost text-xs disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
