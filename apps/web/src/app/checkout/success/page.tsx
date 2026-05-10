'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { verifyPaymentIntent } from '@/actions/payment-intent-verify';
import type { PaymentIntentVerificationResult } from '@/actions/payment-intent-verify';

function useVerifyPayment() {
  const searchParams = useSearchParams();
  const [result, setResult] = useState<PaymentIntentVerificationResult | null>(null);
  const [loading, setLoading] = useState(true);

  const paymentIntentId = searchParams.get('payment_intent');

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

      setResult(await verifyPaymentIntent(paymentIntentId));
      setLoading(false);
    }

    verify();
  }, [paymentIntentId]);

  return { result, loading };
}

function SuccessContent() {
  const { result, loading } = useVerifyPayment();

  if (loading) {
    return (
      <div className="text-center py-10">
        <div className="animate-spin h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-500">Verifying your payment...</p>
      </div>
    );
  }

  const isSuccess = result?.status === 'succeeded' || result?.status === 'processing';

  return (
    <div className="max-w-lg mx-auto text-center">
      <div className="card">
        {isSuccess ? (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {result?.status === 'processing' ? 'Payment Processing' : 'Payment Successful'}
            </h1>
            <p className="text-gray-500 mb-6">{result?.message}</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Failed</h1>
            <p className="text-gray-500 mb-6">{result?.message ?? 'Your payment could not be completed.'}</p>
          </>
        )}
        <div className="flex gap-3 justify-center">
          <a href="/" className="btn-primary inline-block w-auto px-6">Home</a>
          {!isSuccess && (
            <a
              href="/checkout"
              className="border border-primary-600 text-primary-600 px-6 py-3 rounded-lg font-semibold hover:bg-primary-50 transition-colors"
            >
              Retry
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="text-center py-10">
          <div className="animate-spin h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
