'use client';

export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-lg mx-auto">
      <div className="card text-center">
        <h2 className="text-xl font-bold text-zinc-100 mb-2">Checkout failed</h2>
        <p className="text-zinc-400 mb-6 text-sm">
          Unable to initialize checkout. Please try again or contact support.
        </p>
        <button onClick={reset} className="btn-primary">
          Retry checkout
        </button>
      </div>
    </div>
  );
}
