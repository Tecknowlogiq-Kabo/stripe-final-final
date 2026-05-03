'use client';

import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useState } from 'react';

interface PaymentFormProps {
  onSuccess: (paymentIntentId: string) => void;
  onError: (message: string) => void;
  submitLabel?: string;
}

/**
 * Embedded Payment Element form — users never leave the app.
 *
 * Key: `redirect: 'if_required'` prevents external redirects for standard
 * card payments. Only redirects when the payment method genuinely requires
 * bank auth (e.g. iDEAL, Bancontact). The return_url handles that case
 * within our own domain.
 */
export function PaymentForm({
  onSuccess,
  onError,
  submitLabel = 'Pay Now',
}: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsLoading(true);
    setErrorMessage(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // return_url handles redirect-based payment methods (3DS, bank redirects)
        // User returns to our success page — stays within the app domain
        return_url: `${window.location.origin}/checkout/success`,
      },
      // CRITICAL: prevents redirect for card payments that don't require 3DS
      redirect: 'if_required',
    });

    setIsLoading(false);

    if (error) {
      // error.message is safe to show (Stripe formats decline messages)
      const msg = error.message ?? 'Payment failed. Please try again.';
      setErrorMessage(msg);
      onError(msg);
    } else if (paymentIntent?.status === 'succeeded') {
      onSuccess(paymentIntent.id);
    } else if (paymentIntent?.status === 'processing') {
      // Bank transfers / delayed notifications
      onSuccess(paymentIntent.id);
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
      />

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {errorMessage}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || !stripe || !elements}
        className="btn-primary"
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
