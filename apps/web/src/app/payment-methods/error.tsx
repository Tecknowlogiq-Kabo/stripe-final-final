'use client';

export default function PaymentMethodsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="card text-center">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Failed to load payment methods</h2>
        <p className="text-gray-500 mb-6 text-sm">
          Unable to retrieve payment method data. Please try again.
        </p>
        <button onClick={reset} className="btn-primary">
          Retry
        </button>
      </div>
    </div>
  );
}
