'use client';

import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useState, useCallback } from 'react';
import { mapStripeError, mapPaymentIntentStatus, type MappedStripeError } from '@/lib/stripe-errors';

export interface PaymentFormResult {
  paymentIntentId: string;
  status: string;
}

interface PaymentFormProps {
  onSuccess: (result: PaymentFormResult) => void;
  onError: (mapped: MappedStripeError) => void;
  submitLabel?: string;
  onRecoverableError?: () => void;
}

/**
 * Embedded Payment Element form — users never leave the app.
 *
 * Comprehensive error handling covers:
 *   - All Stripe error types (card_error, validation_error, api_error, etc.)
 *   - All PaymentIntent statuses (succeeded, processing, requires_action, etc.)
 *   - Network failures and unexpected JS exceptions
 *   - Distinguishes recoverable vs non-recoverable failures
 *
 * `redirect: 'if_required'` prevents external redirects for standard card
 * payments; only redirects for bank-auth methods (e.g. iDEAL, 3DS).
 */
export function PaymentForm({
  onSuccess,
  onError,
  submitLabel = 'Pay Now',
  onRecoverableError,
}: PaymentFormProps) {
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
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/success`,
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

      if (!paymentIntent) {
        const mapped: MappedStripeError = {
          title: 'Unexpected result',
          message: 'No payment result was returned. Your card was not charged.',
          recoverability: 'retry',
          action: 'Please try again.',
        };
        setErrorState(mapped);
        onError(mapped);
        setIsLoading(false);
        return;
      }

      const statusError = mapPaymentIntentStatus(paymentIntent.status);
      if (statusError) {
        setErrorState(statusError);
        onError(statusError);
        if (statusError.recoverability !== 'non-recoverable' && onRecoverableError) {
          onRecoverableError();
        }
        setIsLoading(false);
        return;
      }

      // Success cases: succeeded | processing
      onSuccess({
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
      });
    } catch (unexpected) {
      const mapped: MappedStripeError = {
        title: 'Unexpected error',
        message:
          unexpected instanceof Error
            ? unexpected.message
            : 'An unexpected error occurred. Your card was not charged.',
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
          wallets: {
            applePay: 'auto',
            googlePay: 'auto',
          },
        }}
        onChange={clearError}
      />

      {errorState && (
        <div role="alert" className="alert-error">
          <p className="font-semibold">{errorState.title}</p>
          <p className="mt-1">{errorState.message}</p>
          {errorState.action && (
            <p className="mt-1 text-xs opacity-80">{errorState.action}</p>
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
            Processing...
          </span>
        ) : (
          submitLabel
        )}
      </button>
    </form>
  );
}
