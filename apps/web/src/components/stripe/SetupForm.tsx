'use client';

import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useState } from 'react';

interface SetupFormProps {
  onSuccess: () => void;
  onError: (message: string) => void;
}

/**
 * Payment method setup form — saves card without charging.
 * Uses confirmSetup with redirect: 'if_required' to stay in-app.
 */
export function SetupForm({ onSuccess, onError }: SetupFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsLoading(true);
    setErrorMessage(null);

    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/payment-methods`,
      },
      redirect: 'if_required',
    });

    setIsLoading(false);

    if (error) {
      const msg = error.message ?? 'Failed to save payment method.';
      setErrorMessage(msg);
      onError(msg);
    } else {
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement
        options={{
          layout: 'tabs',
          wallets: { applePay: 'never', googlePay: 'never' },
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
        {isLoading ? 'Saving...' : 'Save Payment Method'}
      </button>
    </form>
  );
}
