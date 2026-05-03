import { getSubscriptionPlans } from '@/actions/subscriptions';

interface Plan {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  description?: string;
  stripePriceId: string;
}

export default async function SubscriptionsPage() {
  let plans: Plan[] = [];
  let error: string | null = null;

  try {
    plans = await getSubscriptionPlans();
  } catch {
    error = 'Failed to load plans. Make sure the API is running.';
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Subscription Plans</h1>
        <p className="text-gray-500 mt-1">Choose the plan that works for you</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {plans.length === 0 && !error ? (
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
