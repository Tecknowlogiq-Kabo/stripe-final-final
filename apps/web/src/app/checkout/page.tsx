'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPaymentIntent } from '@/actions/payment-intents';
import { StripeProvider } from '@/components/stripe/StripeProvider';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';
import { AmountEntryForm } from '@/components/checkout/AmountEntryForm';
import { useMyCustomer } from '@/features/customers/customers.hooks';

type Step = 'select' | 'payment';

export default function CheckoutPage() {
  const router = useRouter();

  const { data: myCustomer, isLoading: isLoadingCustomer } = useMyCustomer();
  const customerId = myCustomer?.id;

  const [step, setStep] = useState<Step>('select');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState('usd');
  const [isCreatingPI, setIsCreatingPI] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFormData, setLastFormData] = useState<{
    amount: number;
    currency: string;
    paymentMethodType: string;
    savePaymentMethod: boolean;
  } | null>(null);

  if (isLoadingCustomer) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="card animate-pulse">
          <div className="h-6 bg-zinc-800 rounded w-1/3 mb-6" />
          <div className="h-10 bg-zinc-800 rounded mb-4" />
          <div className="h-10 bg-zinc-800 rounded" />
        </div>
      </div>
    );
  }

  if (!customerId) {
    router.push('/account');
    return null;
  }

  const handleSubmit = async (data: {
    amount: number;
    currency: string;
    paymentMethodType: string;
    savePaymentMethod: boolean;
  }) => {
    setError(null);
    setIsCreatingPI(true);
    setLastFormData(data);

    try {
      const result = await createPaymentIntent({
        amount: data.amount,
        currency: data.currency,
        customerId,
        paymentMethodTypes: [data.paymentMethodType],
        setupFutureUsage: data.savePaymentMethod ? 'off_session' : undefined,
      });
      setAmount(data.amount);
      setCurrency(data.currency);
      setClientSecret(result.clientSecret);
      setStep('payment');
    } catch (err) {
      const friendly = friendlyErrorMessage(err);
      setError(friendly);
    } finally {
      setIsCreatingPI(false);
    }
  };

  const handleBack = () => {
    setStep('select');
    setClientSecret(null);
    setError(null);
  };

  const handleRetry = () => {
    if (lastFormData) {
      handleSubmit(lastFormData);
    }
  };

  /** Map raw error messages to user-friendly text. */
  const friendlyErrorMessage = (err: unknown): string => {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('unable to reach')) {
        return 'Connection failed. Please check your internet and try again.';
      }
      if (msg.includes('internal server error') || msg.includes('service is experiencing')) {
        return 'Something went wrong on our end. Please try again.';
      }
      return err.message;
    }
    return 'Failed to create payment. Please try again.';
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="card">
        <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight mb-6">
          {step === 'select' ? 'Checkout' : 'Complete Payment'}
        </h1>

        {error && (
          <div role="alert" className="alert-error mb-4">
            <p className="mb-2">{error}</p>
            {lastFormData && (
              <button
                type="button"
                onClick={handleRetry}
                className="text-sm font-medium text-zinc-100 underline hover:no-underline"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {step === 'select' && (
          <AmountEntryForm
            onSubmit={handleSubmit}
            isLoading={isCreatingPI}
          />
        )}

        {step === 'payment' && clientSecret && (
          <StripeProvider clientSecret={clientSecret}>
            <CheckoutForm amount={amount} currency={currency} onBack={handleBack} />
          </StripeProvider>
        )}
      </div>
    </div>
  );
}
