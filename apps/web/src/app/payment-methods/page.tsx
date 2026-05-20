'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { StripeProvider } from '@/components/stripe/StripeProvider';
import { SetupForm } from '@/components/stripe/SetupForm';
import type { MappedStripeError } from '@/lib/stripe-errors';
import { useMyCustomer } from '@/features/customers/customers.hooks';
import {
  useCustomerPaymentMethods,
  useDetachPaymentMethod,
  useSetDefaultPaymentMethod,
} from '@/features/payment-methods/payment-methods.hooks';
import type { PaymentMethod } from '@/features/payment-methods/payment-methods.types';
import { createSetupIntent } from '@/actions/setup-intents';

function getPaymentMethodLabel(pm: PaymentMethod): string {
  const d = pm.details as Record<string, unknown> | undefined;
  const last4 = (d?.last4 as string | undefined) ?? '';
  switch (pm.type) {
    case 'card':
      return `${pm.brand ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1) : 'Card'} •••• ${pm.last4 ?? ''}`;
    case 'sepa_debit': return `SEPA •••• ${last4}`;
    case 'us_bank_account': return `ACH •••• ${last4}`;
    case 'bacs_debit': return `BACS •••• ${last4}`;
    case 'au_becs_debit': return `BECS •••• ${last4}`;
    case 'acss_debit': return `ACSS •••• ${last4}`;
    case 'nz_bank_account': return `NZ Bank •••• ${last4}`;
    case 'ideal': {
      const bank = d?.bank as string | undefined;
      return bank ? `iDEAL – ${bank}` : 'iDEAL';
    }
    case 'bancontact': return 'Bancontact';
    case 'giropay': return 'giropay';
    case 'sofort': return 'SOFORT';
    case 'eps': return 'EPS';
    case 'p24': return 'Przelewy24';
    case 'fpx': return 'FPX';
    case 'klarna': return 'Klarna';
    case 'afterpay_clearpay': return 'Afterpay / Clearpay';
    case 'affirm': return 'Affirm';
    case 'zip': return 'Zip';
    case 'alipay': return 'Alipay';
    case 'wechat_pay': return 'WeChat Pay';
    case 'cashapp': {
      const tag = (d?.cashtag as string | undefined) ?? '';
      return tag ? `Cash App (${tag})` : 'Cash App';
    }
    case 'paypal': {
      const email = pm.billingDetails?.email ?? '';
      return email ? `PayPal (${email})` : 'PayPal';
    }
    case 'link': return 'Link';
    case 'amazon_pay': return 'Amazon Pay';
    case 'revolut_pay': return 'Revolut Pay';
    case 'mobilepay': return 'MobilePay';
    case 'boleto': return 'Boleto';
    case 'oxxo': return 'OXXO';
    case 'multibanco': return 'Multibanco';
    case 'konbini': return 'Konbini';
    default: return pm.type.replace(/_/g, ' ');
  }
}

function getPaymentMethodSubtitle(pm: PaymentMethod): string | null {
  if (pm.type === 'card') {
    if (pm.cardWalletType) {
      return pm.cardWalletType === 'apple_pay' ? 'Apple Pay'
        : pm.cardWalletType === 'google_pay' ? 'Google Pay'
        : pm.cardWalletType.replace(/_/g, ' ');
    }
    if (pm.expMonth && pm.expYear) {
      return `Expires ${String(pm.expMonth).padStart(2, '0')}/${pm.expYear}`;
    }
  }
  if (pm.country) return pm.country;
  return null;
}

export default function PaymentMethodsPage() {
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<MappedStripeError | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [isRecoverable, setIsRecoverable] = useState(false);
  const [detachingPm, setDetachingPm] = useState<PaymentMethod | null>(null);

  const { data: myCustomer } = useMyCustomer();
  const customerId = myCustomer?.id ?? '';

  const { data: paymentMethods = [], isLoading, isFetching, refetch } = useCustomerPaymentMethods(customerId);
  const [detach, { isLoading: isDetaching }] = useDetachPaymentMethod();
  const [setDefault, { isLoading: isSettingDefault }] = useSetDefaultPaymentMethod();

  const handleAddNew = async () => {
    if (!customerId) return;
    setSetupError(null);
    setIsRecoverable(false);
    try {
      const result = await createSetupIntent({ customerId });
      setSetupClientSecret(result.clientSecret);
      setAddingNew(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize setup';
      setSetupError({ title: 'Setup failed', message: msg, recoverability: 'retry', action: 'Please try again.' });
    }
  };

  const handleSetupSuccess = () => {
    setAddingNew(false);
    setSetupClientSecret(null);
    setSetupError(null);
    setIsRecoverable(false);
    refetch();
  };

  const handleSetupError = useCallback((mapped: MappedStripeError) => {
    setSetupError(mapped);
    setIsRecoverable(mapped.recoverability !== 'non-recoverable');
  }, []);

  const handleSetupRecoverableError = useCallback(() => { setIsRecoverable(true); }, []);
  const handleRetrySetup = useCallback(() => { setSetupError(null); setIsRecoverable(false); }, []);

  if (!customerId) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="page-title">Payment Methods</h1>
          <p className="page-subtitle">Manage saved payment methods</p>
        </div>
        <div className="card text-center py-10">
          <p className="text-zinc-500 text-sm">
            Payment methods are customer-specific.{' '}
            <Link href="/checkout" className="text-indigo-400 hover:text-indigo-300">Make a payment</Link>{' '}
            to save a payment method.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="page-title">Payment Methods</h1>
          <p className="page-subtitle">Manage saved payment methods</p>
        </div>
        {!addingNew && (
          <button onClick={handleAddNew} className="btn-primary">
            Add Payment Method
          </button>
        )}
      </div>

      {setupError && (
        <div role="alert" className="alert-error mb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{setupError.title}</p>
              <p className="mt-1">{setupError.message}</p>
              {setupError.action && <p className="text-xs mt-1 opacity-80">{setupError.action}</p>}
            </div>
            {isRecoverable && (
              <button onClick={handleRetrySetup} className="shrink-0 text-sm font-semibold underline underline-offset-2 hover:opacity-80">
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {addingNew && setupClientSecret && (
        <div className="card mb-6">
          <h2 className="text-base font-semibold text-zinc-100 mb-4">Add New Payment Method</h2>
          <StripeProvider clientSecret={setupClientSecret} mode="setup">
            <SetupForm onSuccess={handleSetupSuccess} onError={handleSetupError} onRecoverableError={handleSetupRecoverableError} />
          </StripeProvider>
          <button
            onClick={() => { setAddingNew(false); setSetupClientSecret(null); setSetupError(null); setIsRecoverable(false); }}
            className="mt-3 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {isLoading || isFetching ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="card animate-pulse flex items-center gap-4 py-4">
              <div className="h-8 w-12 bg-zinc-800 rounded" />
              <div className="flex-1">
                <div className="h-4 bg-zinc-800 rounded w-1/3 mb-2" />
                <div className="h-3 bg-zinc-800/60 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : paymentMethods.length === 0 ? (
        <div className="card text-center py-10 text-zinc-500 text-sm">
          No saved payment methods. Click &quot;Add Payment Method&quot; to save one.
        </div>
      ) : (
        <div className="space-y-2">
          {paymentMethods.map((pm) => {
            const label = getPaymentMethodLabel(pm);
            const subtitle = getPaymentMethodSubtitle(pm);
            return (
              <div
                key={pm.id}
                className={`card flex items-center gap-4 py-4 ${pm.isDefault ? 'border-indigo-500/40' : ''}`}
              >
                <span className="badge-gray shrink-0 font-mono text-xs">
                  {pm.type === 'card' && pm.brand
                    ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)
                    : pm.type.replace(/_/g, ' ')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-100 mono truncate">
                    {label}
                    {pm.isDefault && (
                      <span className="ml-2 badge-blue text-xs">Default</span>
                    )}
                  </p>
                  {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  {!pm.isDefault && (
                    <button
                      onClick={() => setDefault({ id: pm.id, customerId })}
                      disabled={isSettingDefault}
                      className="btn-ghost text-xs px-2 py-1"
                    >
                      Set default
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (pm.isDefault) {
                        setDetachingPm(pm);
                      } else {
                        detach({ id: pm.id, customerId });
                      }
                    }}
                    disabled={isDetaching}
                    className="btn-danger text-xs px-2 py-1"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detach default PM confirmation dialog */}
      {detachingPm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card max-w-sm mx-4" role="dialog" aria-modal="true">
            <h3 className="text-lg font-semibold text-zinc-100 mb-2">Remove default payment method?</h3>
            <p className="text-sm text-zinc-400 mb-4">
              <strong>{getPaymentMethodLabel(detachingPm)}</strong> is your default payment method.
              Removing it may cause active subscriptions to fail on the next payment.
            </p>
            <p className="text-xs text-amber-400 mb-4">
              Please set another payment method as default first, or remove this one and update your subscriptions.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDetachingPm(null)}
                className="btn-ghost text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  detach({ id: detachingPm.id, customerId });
                  setDetachingPm(null);
                }}
                className="btn-danger text-sm"
              >
                Remove anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
