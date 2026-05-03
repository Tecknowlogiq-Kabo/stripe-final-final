import { Suspense } from 'react';

interface SuccessPageProps {
  searchParams: {
    payment_intent?: string;
    payment_intent_client_secret?: string;
    redirect_status?: string;
  };
}

function SuccessContent({ searchParams }: SuccessPageProps) {
  const status = searchParams.redirect_status;
  const isSuccess = status === 'succeeded' || !status;

  return (
    <div className="max-w-lg mx-auto text-center">
      <div className="card">
        {isSuccess ? (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful</h1>
            <p className="text-gray-500 mb-6">
              Your payment has been processed successfully.
            </p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Failed</h1>
            <p className="text-gray-500 mb-6">
              Your payment could not be completed. Please try again.
            </p>
          </>
        )}
        <div className="flex gap-3 justify-center">
          <a href="/" className="btn-primary inline-block w-auto px-6">Home</a>
          {!isSuccess && (
            <a href="/checkout" className="border border-primary-600 text-primary-600 px-6 py-3 rounded-lg font-semibold hover:bg-primary-50 transition-colors">
              Retry
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SuccessPage(props: SuccessPageProps) {
  return (
    <Suspense fallback={<div className="text-center py-10">Loading...</div>}>
      <SuccessContent {...props} />
    </Suspense>
  );
}
