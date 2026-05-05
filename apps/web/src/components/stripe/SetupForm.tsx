'use client';

import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useState, useCallback } from 'react';
import { mapStripeError, mapSetupIntentStatus, type MappedStripeError } from '@/lib/stripe-errors';

interface SetupFormProps {
  onSuccess: () => void;
  onError: (mapped: MappedStripeError) => void;
  onRecoverableError?: () => void;
}

/**
 * Payment method setup form — saves card without charging.
 *
 * Uses confirmSetup with redirect: 'if_required' to stay in-app.
 * Comprehensive error handling covers all Stripe error types and
 * SetupIntent statuses with user-friendly, actionable messages.
 */
export function SetupForm({ onSuccess, onError, onRecoverableError }: SetupFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isLoading, setIsLoading] = useState(false);
  const [errorState, setErrorState] = useState<MappedStripeError | null>(null);

  const clearError = useCallback(() => {
    setErrorState(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsLoading(true);
    setErrorState(null);

    try {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/payment-methods`,
        },
        redirect: 'if_required',
      });

      if (error) {
        const mapped = mapStripeError(error);
        setErrorState(mapped);
        onError(mapped);
        if (mapped.recoverability !== 'non-recoverable' && onRecoverableError) {
          onRecoverableError();
        }
        setIsLoading(false);
        return;
      }

      if (!setupIntent) {
        const mapped: MappedStripeError = {
          title: 'Unexpected result',
          message: 'No setup result was returned. Your card was not saved.',
          recoverability: 'retry',
          action: 'Please try again.',
        };
        setErrorState(mapped);
        onError(mapped);
        setIsLoading(false);
        return;
      }

      const statusError = mapSetupIntentStatus(setupIntent.status);
      if (statusError) {
        setErrorState(statusError);
        onError(statusError);
        if (statusError.recoverability !== 'non-recoverable' && onRecoverableError) {
          onRecoverableError();
        }
        setIsLoading(false);
        return;
      }

      onSuccess();
    } catch (unexpected) {
      const mapped: MappedStripeError = {
        title: 'Unexpected error',
        message:
          unexpected instanceof Error
            ? unexpected.message
            : 'An unexpected error occurred. Your card was not saved.',
        recoverability: 'retry',
        action: 'Please try again or contact support if the problem persists.',
      };
      setErrorState(mapped);
      onError(mapped);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement
        options={{
          layout: 'tabs',
          wallets: { applePay: 'never', googlePay: 'never' },
        }}
        onChange={clearError}
      />

      {errorState && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm"
        >
          <p className="font-semibold">{errorState.title}</p>
          <p className="mt-1">{errorState.message}</p>
          {errorState.action && (
            <p className="mt-1 text-red-600 text-xs">{errorState.action}</p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || !stripe || !elements}
        className="btn-primary w-full"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Saving...
          </span>
        ) : (
          'Save Payment Method'
        )}
      </button>
    </form>
  );
}
