'use client';

export default function SubscriptionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="card text-center">
        <h2 className="text-xl font-bold text-zinc-100 mb-2">Failed to load subscriptions</h2>
        <p className="text-zinc-400 mb-6 text-sm">
          Unable to retrieve subscription data. Please try again.
        </p>
        <button onClick={reset} className="btn-primary">
          Retry
        </button>
      </div>
    </div>
  );
}
