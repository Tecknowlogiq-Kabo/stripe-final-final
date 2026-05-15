'use client';

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

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse flex items-center gap-4 py-2">
          <div className="h-4 bg-zinc-800 rounded w-20" />
          <div className="h-4 bg-zinc-800 rounded w-16" />
          <div className="h-3 bg-zinc-800/60 rounded w-32 ml-auto" />
        </div>
      ))}
    </div>
  );
}

interface PaymentHistoryPreviewProps {
  title?: string;
  description?: string;
  limit?: number;
  focusPaymentIntentId?: string;
}

export function PaymentHistoryPreview({
  title = 'Recent payments',
  description = 'Track your latest payments without leaving the dashboard.',
  limit = 3,
  focusPaymentIntentId,
}: PaymentHistoryPreviewProps) {
  const { data: myCustomer, isPending: isCustomerLoading, isError: isCustomerError, error: customerError } = useMyCustomer();
  const customerId = myCustomer?.id ?? '';

  const { data: response, isPending, isError, isFetching, refetch } = useCustomerPaymentIntents(
    { customerId, page: 1, limit },
  );

  const isMissingCustomer =
    isCustomerError &&
    customerError instanceof Error &&
    'status' in customerError &&
    (customerError as { status?: number }).status === 404;

  const showLoading = isCustomerLoading || isPending || isFetching;

  return (
    <section className="card">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
          <p className="text-xs text-zinc-500 mt-1">{description}</p>
        </div>
        <Link href="/payments" className="text-xs font-medium text-indigo-400 hover:text-indigo-300 whitespace-nowrap">
          View all
        </Link>
      </div>

      {showLoading ? (
        <SkeletonRows />
      ) : isMissingCustomer || !customerId ? (
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-4 text-sm text-zinc-400">
          Payment history appears after you create a customer profile and complete a checkout.
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/checkout" className="btn-primary">
              New payment
            </Link>
            <Link href="/account" className="btn-ghost border border-zinc-700">
              Set up account
            </Link>
          </div>
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-zinc-300">
          <p className="font-medium text-red-300">Unable to load payment history.</p>
          <p className="mt-1 text-zinc-400">Make sure the API is running and your session is still valid.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => refetch()} className="btn-ghost border border-zinc-700">
              Try again
            </button>
            <Link href="/payments" className="btn-primary">
              Open payments
            </Link>
          </div>
        </div>
      ) : !response || response.data.length === 0 ? (
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-4 text-sm text-zinc-400">
          No payments yet. Complete a checkout to see history here.
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/checkout" className="btn-primary">
              Make a payment
            </Link>
            <Link href="/payments" className="btn-ghost border border-zinc-700">
              Open payments
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {response.data.map((paymentIntent: PaymentIntent) => {
            const isFocused = focusPaymentIntentId === paymentIntent.stripePaymentIntentId;
            return (
              <Link
                key={paymentIntent.id}
                href="/payments"
                className={`flex items-center gap-4 rounded-lg border px-3 py-3 transition-colors hover:border-indigo-500/40 hover:bg-zinc-950/30 ${
                  isFocused ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-zinc-800/80 bg-zinc-950/20'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="mono text-sm font-medium text-zinc-100">
                      {formatAmount(paymentIntent.amount, paymentIntent.currency)}
                    </span>
                    <StatusBadge status={paymentIntent.status} />
                    {isFocused && (
                      <span className="text-[11px] uppercase tracking-wide text-indigo-300">
                        This payment
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                    <span>{paymentIntent.description ?? 'No description'}</span>
                    <span>•</span>
                    <span>{formatDate(paymentIntent.createdAt)}</span>
                  </div>
                </div>
                <span className="text-xs text-zinc-500 mono shrink-0">
                  {paymentIntent.receiptEmail ?? 'Receipt unavailable'}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
