'use client';

import { Elements } from '@stripe/react-stripe-js';
import type { StripeElementsOptions } from '@stripe/stripe-js';
import { getStripe } from '@/lib/stripe';
import { useState, useEffect } from 'react';

interface StripeProviderProps {
  clientSecret: string;
  children: React.ReactNode;
  mode?: 'payment' | 'setup';
}

/**
 * Wraps children with Stripe Elements context.
 * Must be used as a client component — Stripe.js only runs in the browser.
 *
 * Features:
 *   - loader: 'auto' shows a Stripe-branded loading skeleton
 *   - Catches invalid clientSecret early and renders a fallback
 */
export function StripeProvider({
  clientSecret,
  children,
  mode = 'payment',
}: StripeProviderProps) {
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    // Stripe client secrets are prefixed with pi_ (payment) or seti_ (setup)
    const validPrefix = mode === 'payment' ? 'pi_' : 'seti_';
    if (!clientSecret.startsWith(validPrefix)) {
      setInitError(
        `Invalid checkout session. Expected ${validPrefix} secret, got: ${clientSecret.slice(0, 10)}...`
      );
    } else {
      setInitError(null);
    }
  }, [clientSecret, mode]);

  if (initError) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
        <p className="font-semibold">Session error</p>
        <p className="mt-1">{initError}</p>
        <p className="mt-1 text-xs">Refresh the page to start a new checkout.</p>
      </div>
    );
  }

  const options: StripeElementsOptions = {
    clientSecret,
    loader: 'auto',
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#4f46e5',
        colorBackground: '#ffffff',
        colorText: '#1f2937',
        colorDanger: '#ef4444',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        spacingUnit: '4px',
        borderRadius: '8px',
      },
      rules: {
        '.Input': {
          boxShadow: 'none',
          border: '1px solid #d1d5db',
        },
        '.Input:focus': {
          border: '1px solid #4f46e5',
          boxShadow: '0 0 0 3px rgba(79, 70, 229, 0.1)',
        },
      },
    },
  };

  return (
    <Elements stripe={getStripe()} options={options}>
      {children}
    </Elements>
  );
}
