'use client';

import { useState, useCallback } from 'react';
import { PaymentForm, type PaymentFormResult } from '@/components/stripe/PaymentForm';
import type { MappedStripeError } from '@/lib/stripe-errors';

interface CheckoutFormProps {
  amount: number;
  currency: string;
  onBack?: () => void;
}

export function CheckoutForm({ amount, currency, onBack }: CheckoutFormProps) {
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
        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/20">
          <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-zinc-100 mb-2">
          {isProcessing ? 'Payment Processing' : 'Payment Successful'}
        </h2>
        <p className="text-zinc-500 text-sm mb-6">
          {isProcessing
            ? 'Your payment is being processed. You will receive confirmation shortly.'
            : 'Your payment has been processed successfully.'}
        </p>
        <a href="/" className="btn-primary inline-flex w-auto px-8">
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
      <div className="mb-6 p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-zinc-400">Amount due</span>
          <span className="mono text-xl font-semibold text-zinc-100">{formattedAmount}</span>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-indigo-400 hover:text-indigo-300 mt-2 transition-colors"
          >
            Change amount
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="alert-error mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{error.title}</p>
              <p className="mt-1">{error.message}</p>
              {error.action && (
                <p className="text-xs mt-1 opacity-80">{error.action}</p>
              )}
            </div>
            {isRecoverable && (
              errorCount >= 3 ? (
                <p className="shrink-0 text-sm font-semibold">
                  Please contact support.
                </p>
              ) : (
                <button
                  onClick={handleRetry}
                  className="shrink-0 text-sm font-semibold underline underline-offset-2 hover:opacity-80"
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
