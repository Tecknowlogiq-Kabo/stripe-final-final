'use client';

import { Elements } from '@stripe/react-stripe-js';
import type { StripeElementsOptions } from '@stripe/stripe-js';
import { getStripe } from '@/lib/stripe';

interface StripeProviderProps {
  clientSecret: string;
  children: React.ReactNode;
  mode?: 'payment' | 'setup';
}

/**
 * Wraps children with Stripe Elements context.
 * Must be used as a client component — Stripe.js only runs in the browser.
 */
export function StripeProvider({
  clientSecret,
  children,
  mode = 'payment',
}: StripeProviderProps) {
  const options: StripeElementsOptions = {
    clientSecret,
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
