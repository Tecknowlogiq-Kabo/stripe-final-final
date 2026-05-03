'use client';

import { useState } from 'react';
import { PaymentForm } from '@/components/stripe/PaymentForm';

interface CheckoutFormProps {
  amount: number;
  currency: string;
}

export function CheckoutForm({ amount, currency }: CheckoutFormProps) {
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (succeeded) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful!</h2>
        <p className="text-gray-500 mb-6">Your payment has been processed.</p>
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
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <PaymentForm
        onSuccess={() => setSucceeded(true)}
        onError={setError}
        submitLabel={`Pay ${formattedAmount}`}
      />
    </div>
  );
}
