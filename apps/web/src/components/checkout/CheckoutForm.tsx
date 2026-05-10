'use client';

import { useState, useCallback } from 'react';
import { PaymentForm, type PaymentFormResult } from '@/components/stripe/PaymentForm';
import type { MappedStripeError } from '@/lib/stripe-errors';

interface CheckoutFormProps {
  amount: number;
  currency: string;
}

export function CheckoutForm({ amount, currency }: CheckoutFormProps) {
  const [succeeded, setSucceeded] = useState(false);
  const [result, setResult] = useState<PaymentFormResult | null>(null);
  const [error, setError] = useState<MappedStripeError | null>(null);
  const [isRecoverable, setIsRecoverable] = useState(false);
  const [errorCount, setErrorCount] = useState(0);

  const handleSuccess = useCallback((paymentResult: PaymentFormResult) => {
    setResult(paymentResult);
    setSucceeded(true);
    setError(null);
    setIsRecoverable(false);
  }, []);

  const handleError = useCallback((mapped: MappedStripeError) => {
    setErrorCount(c => c + 1);
    setError(mapped);
    setIsRecoverable(mapped.recoverability !== 'non-recoverable');
  }, []);

  const handleRecoverableError = useCallback(() => {
    setIsRecoverable(true);
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    setIsRecoverable(false);
    setSucceeded(false);
  }, []);

  if (succeeded) {
    const isProcessing = result?.status === 'processing';
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {isProcessing ? 'Payment Processing' : 'Payment Successful!'}
        </h2>
        <p className="text-gray-500 mb-6">
          {isProcessing
            ? 'Your payment is being processed. You will receive confirmation shortly.'
            : 'Your payment has been processed.'}
        </p>
        <a href="/" className="btn-primary inline-block w-auto px-8">
          Back to Home
        </a>
      </div>
    );
  }

  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);

  return (
    <div>
      <div className="mb-6 p-4 bg-gray-50 rounded-lg flex justify-between items-center">
        <span className="text-gray-600 font-medium">Amount due</span>
        <span className="text-2xl font-bold text-gray-900">{formattedAmount}</span>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-sm">{error.title}</p>
              <p className="text-sm mt-1">{error.message}</p>
              {error.action && (
                <p className="text-xs mt-1 text-red-600">{error.action}</p>
              )}
            </div>
            {isRecoverable && (
              errorCount >= 3 ? (
                <p className="shrink-0 text-sm font-semibold text-red-700">
                  Please contact support.
                </p>
              ) : (
                <button
                  onClick={handleRetry}
                  className="shrink-0 text-sm font-semibold text-red-700 hover:text-red-900 underline underline-offset-2"
                >
                  Try again
                </button>
              )
            )}
          </div>
        </div>
      )}

      <PaymentForm
        onSuccess={handleSuccess}
        onError={handleError}
        onRecoverableError={handleRecoverableError}
        submitLabel={`Pay ${formattedAmount}`}
      />
    </div>
  );
}
