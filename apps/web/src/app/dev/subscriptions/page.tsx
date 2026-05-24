'use client';

import { notFound } from 'next/navigation';
import { useState } from 'react';
import { useMyCustomer } from '@/features/customers/customers.hooks';
import { useCustomerPaymentMethods } from '@/features/payment-methods/payment-methods.hooks';
import { useCustomerSubscriptions, useCreateSubscription } from '@/features/subscriptions/subscriptions.hooks';
import {
  useSubscriptionBillingRecords,
  useCreateBillingRecord,
  useTriggerCharge,
} from '@/features/billing/billing.hooks';
import type { BillingRecord } from '@/features/billing/billing.types';
import type { CreateSubscriptionInput } from '@/features/subscriptions/subscriptions.types';

if (process.env.NODE_ENV === 'production') notFound();

function BillingStatusBadge({ status }: { status: BillingRecord['status'] }) {
  const classMap: Record<BillingRecord['status'], string> = {
    pending: 'badge-yellow',
    locked: 'badge-blue',
    charged: 'badge-green',
    failed: 'badge-red',
  };
  return <span className={classMap[status]}>{status}</span>;
}

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function BillingSection({ subscriptionId }: { subscriptionId: string }) {
  const { data: records = [], isLoading } = useSubscriptionBillingRecords(subscriptionId);
  const [createRecord, { isLoading: isCreating, error: createError }] = useCreateBillingRecord();
  const [triggerCharge, { isLoading: isTriggering, data: triggerResult, error: triggerError }] =
    useTriggerCharge();

  const [amountInput, setAmountInput] = useState('');
  const [currencyInput, setCurrencyInput] = useState('usd');

  const handleAddRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(amountInput);
    if (isNaN(parsed) || parsed <= 0) return;
    const chargeAmount = Math.round(parsed * 100);
    await createRecord({ subscriptionId, chargeAmount, currency: currencyInput });
    setAmountInput('');
  };

  const handleTrigger = () => {
    triggerCharge(subscriptionId);
  };

  return (
    <section className="mt-8">
      <p className="section-label mb-3">
        Billing Records for{' '}
        <span className="mono text-zinc-300">{subscriptionId}</span>
      </p>

      {isLoading ? (
        <div className="card animate-pulse">
          <div className="h-4 bg-zinc-800 rounded w-1/3" />
        </div>
      ) : records.length === 0 ? (
        <div className="card text-center py-6 text-zinc-500 text-sm">
          No billing records yet. Add one below.
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {records.map((record) => (
            <div key={record.id} className="card flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <BillingStatusBadge status={record.status} />
                  <span className="mono text-sm text-zinc-300">
                    {formatCents(record.chargeAmount, record.currency)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    Period: {formatDate(record.periodDate)}
                  </span>
                </div>
                {record.chargedAt && (
                  <p className="text-xs text-zinc-500">
                    Charged: {formatDate(record.chargedAt)}
                  </p>
                )}
                {record.stripePaymentIntentId && (
                  <p className="mono text-xs text-zinc-500 truncate">
                    PI: {record.stripePaymentIntentId}
                  </p>
                )}
                {record.failureMessage && (
                  <p className="text-xs text-red-400 mt-0.5">{record.failureMessage}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Record Form */}
      <div className="card mb-4">
        <p className="text-sm font-medium text-zinc-300 mb-3">Add Billing Record</p>
        <form onSubmit={handleAddRecord} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Amount (USD)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 w-32 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Currency</label>
            <input
              type="text"
              value={currencyInput}
              onChange={(e) => setCurrencyInput(e.target.value.toLowerCase())}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 w-20 focus:outline-none focus:border-indigo-500"
              maxLength={3}
            />
          </div>
          <button type="submit" disabled={isCreating} className="btn-primary">
            {isCreating ? 'Adding…' : 'Add Billing Record'}
          </button>
        </form>
        {createError && (
          <div className="alert-error mt-3">
            {'data' in createError
              ? JSON.stringify((createError as { data: unknown }).data)
              : 'Failed to add record'}
          </div>
        )}
      </div>

      {/* Trigger Payment */}
      <div className="card">
        <p className="text-sm font-medium text-zinc-300 mb-3">Trigger Payment</p>
        <button onClick={handleTrigger} disabled={isTriggering} className="btn-primary">
          {isTriggering ? 'Triggering…' : 'Trigger Payment Now'}
        </button>
        {triggerResult && (
          <div className="mt-3 p-3 rounded bg-zinc-800 text-sm">
            <p className="text-zinc-300">
              Status: <span className="mono text-indigo-400">{triggerResult.status}</span>
            </p>
            {triggerResult.stripePaymentIntentId && (
              <p className="mono text-xs text-zinc-400 mt-1">
                PI: {triggerResult.stripePaymentIntentId}
              </p>
            )}
            {triggerResult.error && (
              <p className="text-red-400 text-xs mt-1">{triggerResult.error}</p>
            )}
          </div>
        )}
        {triggerError && (
          <div className="alert-error mt-3">
            {'data' in triggerError
              ? JSON.stringify((triggerError as { data: unknown }).data)
              : 'Failed to trigger charge'}
          </div>
        )}
      </div>
    </section>
  );
}

export default function DevSubscriptionsPage() {
  const { data: myCustomer, isLoading: customerLoading } = useMyCustomer();
  const customerId = myCustomer?.id ?? '';

  const { data: paymentMethods = [] } = useCustomerPaymentMethods(customerId);
  const { data: subscriptions = [], isLoading: subsLoading } = useCustomerSubscriptions(customerId);
  const [createSubscription, { isLoading: isCreating, data: newSub, error: createSubError }] =
    useCreateSubscription();

  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState('');
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);

  const handleCreateSubscription = () => {
    if (!myCustomer) return;
    const input: CreateSubscriptionInput = {
      customerId: myCustomer.id,
      ...(selectedPaymentMethodId ? { paymentMethodId: selectedPaymentMethodId } : {}),
    } as CreateSubscriptionInput;
    createSubscription(input);
  };

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <div className="mb-8">
        <h1 className="page-title">Dev: Subscription Test Harness</h1>
        <p className="page-subtitle">Development only — create subscriptions and trigger payments</p>
      </div>

      {/* Section 1: My Customer */}
      <section className="mb-8">
        <p className="section-label mb-3">My Customer</p>
        {customerLoading ? (
          <div className="card animate-pulse">
            <div className="h-4 bg-zinc-800 rounded w-1/3 mb-2" />
            <div className="h-3 bg-zinc-800/60 rounded w-1/4" />
          </div>
        ) : myCustomer ? (
          <div className="card">
            <p className="text-sm text-zinc-300">
              <span className="text-zinc-500">Email: </span>
              {myCustomer.email}
            </p>
            <p className="mono text-xs text-zinc-500 mt-1">{myCustomer.id}</p>
          </div>
        ) : (
          <div className="card border-yellow-500/20 bg-yellow-500/5">
            <p className="text-sm text-yellow-400">
              No customer found. Go to Account to set one up.
            </p>
          </div>
        )}
      </section>

      {/* Section 2: Create Subscription */}
      {myCustomer && (
        <section className="mb-8">
          <p className="section-label mb-3">Create Subscription (no plan)</p>
          <div className="card">
            {paymentMethods.length > 0 && (
              <div className="mb-4">
                <label className="text-xs text-zinc-500 block mb-1">Payment Method (optional)</label>
                <select
                  value={selectedPaymentMethodId}
                  onChange={(e) => setSelectedPaymentMethodId(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 w-full focus:outline-none focus:border-indigo-500"
                >
                  <option value="">None</option>
                  {paymentMethods.map((pm) => (
                    <option key={pm.id} value={pm.stripePaymentMethodId}>
                      {pm.brand?.toUpperCase() ?? pm.type} •••• {pm.last4}
                      {pm.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={handleCreateSubscription}
              disabled={isCreating}
              className="btn-primary"
            >
              {isCreating ? 'Creating…' : 'Create Subscription'}
            </button>
            {newSub && (
              <p className="mono text-xs text-indigo-400 mt-3">Created: {newSub.id}</p>
            )}
            {createSubError && (
              <div className="alert-error mt-3">
                {'data' in createSubError
                  ? JSON.stringify((createSubError as { data: unknown }).data)
                  : 'Failed to create subscription'}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Section 3: My Subscriptions */}
      {myCustomer && (
        <section className="mb-8">
          <p className="section-label mb-3">My Subscriptions</p>
          {subsLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="card animate-pulse">
                  <div className="h-4 bg-zinc-800 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="card text-center py-6 text-zinc-500 text-sm">
              No subscriptions yet. Create one above.
            </div>
          ) : (
            <div className="space-y-2">
              {subscriptions.map((sub) => (
                <div
                  key={sub.id}
                  className={`card flex items-center justify-between gap-4 ${
                    selectedSubId === sub.id ? 'border-indigo-500/40' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`badge-${
                        sub.status === 'active'
                          ? 'green'
                          : sub.status === 'canceled'
                            ? 'red'
                            : 'yellow'
                      }`}
                    >
                      {sub.status}
                    </span>
                    <span className="mono text-xs text-zinc-400 truncate">{sub.id}</span>
                  </div>
                  <button
                    onClick={() => setSelectedSubId(sub.id === selectedSubId ? null : sub.id)}
                    className="btn-ghost shrink-0 text-xs"
                  >
                    {selectedSubId === sub.id ? 'Deselect' : 'Select'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Section 4: Billing Records */}
      {selectedSubId && <BillingSection subscriptionId={selectedSubId} />}
    </div>
  );
}
