'use client';

import { useState } from 'react';
import { useMyCustomer } from '@/features/customers/customers.hooks';
import { useCustomerPaymentIntents } from '@/features/payment-intents/payment-intents.hooks';
import type { PaymentIntent } from '@/features/payment-intents/payment-intents.types';

// ── Display helpers ──────────────────────────────────────────────────────────

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
  const colorMap: Record<string, string> = {
    succeeded: 'bg-green-100 text-green-700',
    processing: 'bg-blue-100 text-blue-700',
    requires_payment_method: 'bg-yellow-100 text-yellow-700',
    requires_action: 'bg-orange-100 text-orange-700',
    canceled: 'bg-red-100 text-red-700',
  };
  const className = colorMap[status] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function PaymentItem({ pi }: { pi: PaymentIntent }) {
  return (
    <div className="card flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-gray-900">
            {formatAmount(pi.amount, pi.currency)}
          </p>
          <StatusBadge status={pi.status} />
        </div>
        {pi.description && (
          <p className="text-sm text-gray-500 mt-0.5">{pi.description}</p>
        )}
        <p className="text-xs text-gray-400 mt-1">{formatDate(pi.createdAt)}</p>
      </div>
      <div className="shrink-0 text-right">
        {pi.amountReceived != null && pi.amountReceived !== pi.amount && (
          <p className="text-xs text-gray-500">
            Received: {formatAmount(pi.amountReceived, pi.currency)}
          </p>
        )}
        {pi.receiptEmail && (
          <p className="text-xs text-gray-400">{pi.receiptEmail}</p>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const [page, setPage] = useState(1);
  const limit = 10;

  const { data: myCustomer } = useMyCustomer();
  const customerId = myCustomer?.id ?? '';

  const { data: response, isPending, isError, isFetching } = useCustomerPaymentIntents(
    { customerId, page, limit },
  );

  const totalPages = response ? Math.ceil(response.total / response.limit) : 0;

  if (!customerId) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Payments</h1>
          <p className="text-gray-500 mt-1">View your payment history</p>
        </div>
        <div className="card text-center py-8 text-gray-500">
          Payment history is customer-specific. Complete a checkout to see payments.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Payments</h1>
        <p className="text-gray-500 mt-1">View your payment history</p>
      </div>

      {isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          Failed to load payments. Make sure the API is running.
        </div>
      )}

      {isPending || isFetching ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card animate-pulse flex items-center gap-4">
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded w-1/4 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : !response || response.data.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          No payments yet. Complete a checkout to see your payment history.
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {response.data.map((pi) => (
              <PaymentItem key={pi.id} pi={pi} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="text-sm font-medium text-primary-600 hover:text-primary-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="text-sm font-medium text-primary-600 hover:text-primary-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
