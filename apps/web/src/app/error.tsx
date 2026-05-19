'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-lg mx-auto mt-20">
      <div className="card text-center">
        <h2 className="text-xl font-bold text-zinc-100 mb-2">Something went wrong</h2>
        <p className="text-zinc-400 mb-6 text-sm">
          {error.digest ? `Error ID: ${error.digest}` : 'An unexpected error occurred.'}
        </p>
        <button onClick={reset} className="btn-primary">
          Try again
        </button>
      </div>
    </div>
  );
}
