import { createPaymentIntent } from '@/actions/payment-intents';
import { StripeProvider } from '@/components/stripe/StripeProvider';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';

interface CheckoutPageProps {
  searchParams: { amount?: string; currency?: string; customerId?: string };
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const amount = Number(searchParams.amount ?? 2000); // default $20.00
  const currency = searchParams.currency ?? 'usd';

  let clientSecret: string;
  let error: string | null = null;

  try {
    const result = await createPaymentIntent({ amount, currency });
    clientSecret = result.clientSecret;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to initialize checkout';
    return (
      <div className="max-w-lg mx-auto">
        <div className="card">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Checkout</h1>
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="card">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Checkout</h1>
        <StripeProvider clientSecret={clientSecret!}>
          <CheckoutForm amount={amount} currency={currency} />
        </StripeProvider>
      </div>
    </div>
  );
}
