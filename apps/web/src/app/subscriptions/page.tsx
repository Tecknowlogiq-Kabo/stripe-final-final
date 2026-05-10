'use client';

import { useSubscriptionPlans } from '@/features/subscriptions/subscriptions.hooks';

export default function SubscriptionsPage() {
  const { data: plans = [], isPending, isError } = useSubscriptionPlans();

  if (isPending) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Subscription Plans</h1>
          <p className="text-gray-500 mt-1">Choose the plan that works for you</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-6 bg-gray-200 rounded mb-3 w-3/4" />
              <div className="h-4 bg-gray-100 rounded mb-6 w-full" />
              <div className="h-10 bg-gray-200 rounded w-1/2 mt-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Subscription Plans</h1>
        <p className="text-gray-500 mt-1">Choose the plan that works for you</p>
      </div>

      {isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          Failed to load plans. Make sure the API is running.
        </div>
      )}

      {!isError && plans.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">
          No plans configured yet. Add plans in your Stripe dashboard and sync them.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div key={plan.id} className="card flex flex-col">
              <h2 className="text-xl font-bold text-gray-900 mb-2">{plan.name}</h2>
              {plan.description && (
                <p className="text-gray-500 text-sm mb-4">{plan.description}</p>
              )}
              <div className="mt-auto">
                <div className="text-3xl font-bold text-primary-600 mb-1">
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: plan.currency.toUpperCase(),
                  }).format(plan.amount / 100)}
                  <span className="text-base font-normal text-gray-500">
                    /{plan.intervalCount > 1 ? `${plan.intervalCount} ` : ''}{plan.interval}
                  </span>
                </div>
                <a
                  href={`/checkout?priceId=${plan.stripePriceId}&amount=${plan.amount}&currency=${plan.currency}`}
                  className="btn-primary block text-center mt-4"
                >
                  Subscribe
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
