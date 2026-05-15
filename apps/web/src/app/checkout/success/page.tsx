'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { verifyPaymentIntent } from '@/actions/payment-intent-verify';
import type { PaymentIntentVerificationResult } from '@/actions/payment-intent-verify';
import Link from 'next/link';
import { PaymentHistoryPreview } from '@/components/payments/PaymentHistoryPreview';

function useVerifyPayment() {
  const searchParams = useSearchParams();
  const [result, setResult] = useState<PaymentIntentVerificationResult | null>(null);
  const [loading, setLoading] = useState(true);

  const paymentIntentId = searchParams.get('payment_intent');
  const redirectStatus = searchParams.get('redirect_status');

  useEffect(() => {
    async function verify() {
      // No payment_intent in URL — user may have navigated here directly
      if (!paymentIntentId) {
        setResult({
          status: 'unknown',
          message: 'No payment information found in the URL.',
        });
        setLoading(false);
        return;
      }

      setResult(await verifyPaymentIntent(paymentIntentId, redirectStatus));
      setLoading(false);
    }

    verify();
  }, [paymentIntentId, redirectStatus]);

  return { result, loading };
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const paymentIntentId = searchParams.get('payment_intent');
  const { result, loading } = useVerifyPayment();

  if (loading) {
    return (
      <div className="text-center py-10">
        <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-zinc-500 text-sm">Verifying your payment...</p>
      </div>
    );
  }

  const isSuccess = result?.status === 'succeeded' || result?.status === 'processing';
  const isWarning = result?.status === 'unknown' || result?.status === 'pending';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="card text-center">
        {isSuccess ? (
          <>
            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/20">
              <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-zinc-100 mb-2">
              {result?.status === 'processing' ? 'Payment Processing' : 'Payment Successful'}
            </h1>
            <p className="text-zinc-500 text-sm mb-6">{result?.message}</p>
          </>
        ) : isWarning ? (
          <>
            <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
              <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86l-8.5 14.72A2 2 0 003.52 21h16.96a2 2 0 001.73-3.02l-8.5-14.72a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-zinc-100 mb-2">Payment received</h1>
            <p className="text-zinc-500 text-sm mb-6">{result?.message}</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500/20">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-zinc-100 mb-2">Payment Failed</h1>
            <p className="text-zinc-500 text-sm mb-6">{result?.message ?? 'Your payment could not be completed.'}</p>
          </>
        )}
        <div className="flex flex-wrap gap-3 justify-center">
          <Link href="/" className="btn-primary">Home</Link>
          <Link href="/payments" className="btn-ghost border border-zinc-700">
            View payment history
          </Link>
          {!isSuccess && !isWarning && (
            <Link href="/checkout" className="btn-ghost border border-zinc-700">
              Retry
            </Link>
          )}
        </div>
      </div>

      <PaymentHistoryPreview
        title="Payment history"
        description="See the latest customer-owned payment intents, including this checkout."
        focusPaymentIntentId={paymentIntentId ?? undefined}
      />
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="text-center py-10">
          <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-zinc-500 text-sm">Loading...</p>
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
