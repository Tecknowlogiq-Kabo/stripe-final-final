'use client';

import { useState } from 'react';
import { useSubscriptionPlans, useCustomerSubscriptions, useUpdateSubscription } from '@/features/subscriptions/subscriptions.hooks';
import { useMyCustomer } from '@/features/customers/customers.hooks';
import { createBillingPortalSession } from '@/actions/billing-portal';
import type { Subscription } from '@/features/subscriptions/subscriptions.types';

// ── Display helpers ──────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function SubStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    active:     'bg-green-100 text-green-700',
    trialing:   'bg-blue-100 text-blue-700',
    past_due:   'bg-yellow-100 text-yellow-700',
    incomplete: 'bg-yellow-100 text-yellow-700',
    unpaid:     'bg-orange-100 text-orange-700',
    canceled:   'bg-red-100 text-red-700',
    paused:     'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorMap[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function SubscriptionCard({ sub, onUpdate, isUpdating }: {
  sub: Subscription;
  onUpdate: (vars: { id: string; cancelAtPeriodEnd: boolean }) => void;
  isUpdating: boolean;
}) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <SubStatusBadge status={sub.status} />
            {sub.cancelAtPeriodEnd && (
              <span className="text-xs text-red-600 font-medium">
                Cancels {formatDate(sub.currentPeriodEnd)}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">
            Current period: {formatDate(sub.currentPeriodStart)} – {formatDate(sub.currentPeriodEnd)}
          </p>
          {sub.trialEnd && new Date(sub.trialEnd) > new Date() && (
            <p className="text-sm text-blue-600 mt-0.5">
              Trial ends {formatDate(sub.trialEnd)}
            </p>
          )}
        </div>
        {sub.status !== 'canceled' && (
          <div className="shrink-0">
            {sub.cancelAtPeriodEnd ? (
              <button
                onClick={() => onUpdate({ id: sub.id, cancelAtPeriodEnd: false })}
                disabled={isUpdating}
                className="text-sm font-medium text-primary-600 hover:text-primary-800 disabled:opacity-50"
              >
                Reactivate
              </button>
            ) : (
              <button
                onClick={() => onUpdate({ id: sub.id, cancelAtPeriodEnd: true })}
                disabled={isUpdating}
                className="text-sm font-medium text-red-500 hover:text-red-700 disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const { data: plans = [], isPending: plansLoading, isError } = useSubscriptionPlans();
  const { data: myCustomer } = useMyCustomer();
  const { data: activeSubscriptions = [], isPending: subsLoading } = useCustomerSubscriptions(myCustomer?.id ?? '');
  const { mutate: updateSub, isPending: isUpdating } = useUpdateSubscription();
  const [portalLoading, setPortalLoading] = useState(false);

  const handleManageBilling = async () => {
    if (!myCustomer) return;
    setPortalLoading(true);
    try {
      const { url } = await createBillingPortalSession({
        customerId: myCustomer.id,
        returnUrl: window.location.href,
      });
      window.location.href = url;
    } catch {
      setPortalLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Subscriptions</h1>
          <p className="text-gray-500 mt-1">Manage your subscriptions and plans</p>
        </div>
        {myCustomer && (
          <button
            onClick={handleManageBilling}
            disabled={portalLoading}
            className="btn-primary shrink-0"
          >
            {portalLoading ? 'Opening…' : 'Manage Billing'}
          </button>
        )}
      </div>

      {/* Active subscriptions */}
      {myCustomer && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Your Subscriptions</h2>
          {subsLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="card animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-1/4 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : activeSubscriptions.length === 0 ? (
            <div className="card text-center py-6 text-gray-500 text-sm">
              No active subscriptions. Choose a plan below to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {activeSubscriptions.map((sub) => (
                <SubscriptionCard
                  key={sub.id}
                  sub={sub}
                  onUpdate={({ id, cancelAtPeriodEnd }) =>
                    updateSub({ id, cancelAtPeriodEnd })
                  }
                  isUpdating={isUpdating}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Plans */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Available Plans</h2>

        {isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            Failed to load plans. Make sure the API is running.
          </div>
        )}

        {plansLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-6 bg-gray-200 rounded mb-3 w-3/4" />
                <div className="h-4 bg-gray-100 rounded mb-6 w-full" />
                <div className="h-10 bg-gray-200 rounded w-1/2 mt-auto" />
              </div>
            ))}
          </div>
        ) : !isError && plans.length === 0 ? (
          <div className="card text-center py-12 text-gray-500">
            No plans configured yet. Add plans in your Stripe dashboard and sync them.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <div key={plan.id} className="card flex flex-col">
                <h3 className="text-xl font-bold text-gray-900 mb-2">{plan.name}</h3>
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
      </section>
    </div>
  );
}
