'use client';

import { useState } from 'react';
import { useSubscriptionPlans, useCustomerSubscriptions, useUpdateSubscription } from '@/features/subscriptions/subscriptions.hooks';
import { useMyCustomer } from '@/features/customers/customers.hooks';
import { createBillingPortalSession } from '@/actions/billing-portal';
import type { Subscription } from '@/features/subscriptions/subscriptions.types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function SubStatusBadge({ status }: { status: string }) {
  const classMap: Record<string, string> = {
    active:     'badge-green',
    trialing:   'badge-blue',
    past_due:   'badge-yellow',
    incomplete: 'badge-yellow',
    unpaid:     'badge-orange',
    canceled:   'badge-red',
    paused:     'badge-gray',
  };
  return (
    <span className={classMap[status] ?? 'badge-gray'}>
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
              <span className="text-xs text-red-400 font-medium">
                Cancels {formatDate(sub.currentPeriodEnd)}
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-400 mono">
            {formatDate(sub.currentPeriodStart)} – {formatDate(sub.currentPeriodEnd)}
          </p>
          {sub.trialEnd && new Date(sub.trialEnd) > new Date() && (
            <p className="text-sm text-blue-400 mt-0.5">
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
                className="text-sm font-medium text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-colors"
              >
                Reactivate
              </button>
            ) : (
              <button
                onClick={() => onUpdate({ id: sub.id, cancelAtPeriodEnd: true })}
                disabled={isUpdating}
                className="text-sm font-medium text-red-400 hover:text-red-300 disabled:opacity-40 transition-colors"
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

export default function SubscriptionsPage() {
  const { data: plans = [], isLoading: plansLoading, isError } = useSubscriptionPlans();
  const { data: myCustomer } = useMyCustomer();
  const { data: activeSubscriptions = [], isLoading: subsLoading } = useCustomerSubscriptions(myCustomer?.id ?? '');
  const [updateSub, { isLoading: isUpdating }] = useUpdateSubscription();
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
          <h1 className="page-title">Subscriptions</h1>
          <p className="page-subtitle">Manage recurring billing plans</p>
        </div>
        {myCustomer && (
          <button
            onClick={handleManageBilling}
            disabled={portalLoading}
            className="btn-ghost border border-zinc-700"
          >
            {portalLoading ? 'Opening…' : 'Billing Portal'}
          </button>
        )}
      </div>

      {myCustomer && (
        <section className="mb-10">
          <p className="section-label mb-3">Active Subscriptions</p>
          {subsLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="card animate-pulse">
                  <div className="h-4 bg-zinc-800 rounded w-1/4 mb-2" />
                  <div className="h-3 bg-zinc-800/60 rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : activeSubscriptions.length === 0 ? (
            <div className="card text-center py-8 text-zinc-500 text-sm">
              No active subscriptions. Choose a plan below to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {activeSubscriptions.map((sub) => (
                <SubscriptionCard
                  key={sub.id}
                  sub={sub}
                  onUpdate={({ id, cancelAtPeriodEnd }) => updateSub({ id, cancelAtPeriodEnd })}
                  isUpdating={isUpdating}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <p className="section-label mb-3">Available Plans</p>

        {isError && (
          <div className="alert-error mb-6">
            Failed to load plans. Make sure the API is running.
          </div>
        )}

        {plansLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-5 bg-zinc-800 rounded mb-3 w-3/4" />
                <div className="h-4 bg-zinc-800/60 rounded mb-6 w-full" />
                <div className="h-9 bg-zinc-800 rounded w-1/2 mt-auto" />
              </div>
            ))}
          </div>
        ) : !isError && plans.length === 0 ? (
          <div className="card text-center py-12 text-zinc-500 text-sm">
            No plans configured yet. Add plans in your Stripe dashboard and sync them.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div key={plan.id} className="card flex flex-col hover:border-indigo-500/30 transition-colors">
                <h3 className="text-base font-semibold text-zinc-100 mb-2">{plan.name}</h3>
                {plan.description && (
                  <p className="text-zinc-500 text-xs mb-4 leading-relaxed">{plan.description}</p>
                )}
                <div className="mt-auto">
                  <div className="mono text-2xl font-semibold text-indigo-400 mb-1">
                    {new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: plan.currency.toUpperCase(),
                    }).format(plan.amount / 100)}
                    <span className="text-sm font-normal text-zinc-500">
                      /{plan.intervalCount > 1 ? `${plan.intervalCount} ` : ''}{plan.interval}
                    </span>
                  </div>
                  <a
                    href={`/checkout?priceId=${plan.stripePriceId}&amount=${plan.amount}&currency=${plan.currency}${myCustomer ? `&customerId=${myCustomer.id}` : ''}`}
                    className="btn-primary w-full mt-4 text-center block"
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
