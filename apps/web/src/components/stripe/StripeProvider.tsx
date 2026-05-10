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
      <div className="alert-error text-sm">
        <p className="font-semibold">Session error</p>
        <p className="mt-1">{initError}</p>
        <p className="mt-1 text-xs opacity-70">Refresh the page to start a new checkout.</p>
      </div>
    );
  }

  const options: StripeElementsOptions = {
    clientSecret,
    loader: 'auto',
    appearance: {
      theme: 'night',
      variables: {
        colorPrimary: '#6366f1',
        colorBackground: '#18181b',
        colorText: '#fafafa',
        colorTextSecondary: '#a1a1aa',
        colorDanger: '#f87171',
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
        spacingUnit: '4px',
        borderRadius: '8px',
      },
      rules: {
        '.Input': {
          backgroundColor: '#27272a',
          border: '1px solid #3f3f46',
          color: '#fafafa',
          boxShadow: 'none',
        },
        '.Input:focus': {
          border: '1px solid #6366f1',
          boxShadow: '0 0 0 2px rgba(99, 102, 241, 0.2)',
        },
        '.Label': {
          color: '#a1a1aa',
          fontSize: '13px',
        },
        '.Tab': {
          backgroundColor: '#27272a',
          border: '1px solid #3f3f46',
          color: '#a1a1aa',
        },
        '.Tab:hover': {
          backgroundColor: '#3f3f46',
          color: '#fafafa',
        },
        '.Tab--selected': {
          backgroundColor: '#27272a',
          border: '1px solid #6366f1',
          color: '#fafafa',
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
