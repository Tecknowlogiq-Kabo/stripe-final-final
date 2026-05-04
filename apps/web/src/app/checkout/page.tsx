import { createPaymentIntent } from '@/actions/payment-intents';
import { StripeProvider } from '@/components/stripe/StripeProvider';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';

interface CheckoutPageProps {
  searchParams: { amount?: string; currency?: string; customerId?: string };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const rawAmount = searchParams.amount;
  const rawCurrency = searchParams.currency;
  const rawCustomerId = searchParams.customerId;

  // Validate and sanitize searchParams to prevent injection via URL manipulation
  const amount =
    rawAmount && /^\d+$/.test(rawAmount)
      ? Math.max(50, parseInt(rawAmount, 10))
      : 2000; // default $20.00
  const currency =
    rawCurrency && /^[a-z]{3}$/.test(rawCurrency) ? rawCurrency : 'usd';
  const customerId =
    rawCustomerId && UUID_RE.test(rawCustomerId) ? rawCustomerId : undefined;

  let clientSecret: string;
  let error: string | null = null;

  try {
    const result = await createPaymentIntent({ amount, currency, customerId });
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
