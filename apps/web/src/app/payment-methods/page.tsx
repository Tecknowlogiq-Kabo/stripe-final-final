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

// ── Display helpers ──────────────────────────────────────────────────────────

function getPaymentMethodLabel(pm: PaymentMethod): string {
  const d = pm.details as Record<string, unknown> | undefined;
  const last4 = (d?.last4 as string | undefined) ?? '';
  switch (pm.type) {
    case 'card':
      return `${pm.brand ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1) : 'Card'} •••• ${pm.last4 ?? ''}`;
    case 'sepa_debit':
      return `SEPA •••• ${last4}`;
    case 'us_bank_account':
      return `ACH •••• ${last4}`;
    case 'bacs_debit':
      return `BACS •••• ${last4}`;
    case 'au_becs_debit':
      return `BECS •••• ${last4}`;
    case 'acss_debit':
      return `ACSS •••• ${last4}`;
    case 'nz_bank_account':
      return `NZ Bank •••• ${last4}`;
    case 'ideal': {
      const bank = d?.bank as string | undefined;
      return bank ? `iDEAL – ${bank}` : 'iDEAL';
    }
    case 'bancontact':
      return 'Bancontact';
    case 'giropay':
      return 'giropay';
    case 'sofort':
      return 'SOFORT';
    case 'eps':
      return 'EPS';
    case 'p24':
      return 'Przelewy24';
    case 'fpx':
      return 'FPX';
    case 'klarna':
      return 'Klarna';
    case 'afterpay_clearpay':
      return 'Afterpay / Clearpay';
    case 'affirm':
      return 'Affirm';
    case 'zip':
      return 'Zip';
    case 'alipay':
      return 'Alipay';
    case 'wechat_pay':
      return 'WeChat Pay';
    case 'cashapp': {
      const tag = (d?.cashtag as string | undefined) ?? '';
      return tag ? `Cash App (${tag})` : 'Cash App';
    }
    case 'paypal': {
      const email = pm.billingDetails?.email ?? '';
      return email ? `PayPal (${email})` : 'PayPal';
    }
    case 'link':
      return 'Link';
    case 'amazon_pay':
      return 'Amazon Pay';
    case 'revolut_pay':
      return 'Revolut Pay';
    case 'mobilepay':
      return 'MobilePay';
    case 'boleto':
      return 'Boleto';
    case 'oxxo':
      return 'OXXO';
    case 'multibanco':
      return 'Multibanco';
    case 'konbini':
      return 'Konbini';
    default:
      return pm.type.replace(/_/g, ' ');
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PaymentMethodsPage() {
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<MappedStripeError | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [isRecoverable, setIsRecoverable] = useState(false);

  const { data: myCustomer } = useMyCustomer();
  const customerId = myCustomer?.id ?? '';

  const {
    data: paymentMethods = [],
    isPending,
    isFetching,
    refetch,
  } = useCustomerPaymentMethods(customerId);

  const { mutate: detach, isPending: isDetaching } = useDetachPaymentMethod();
  const { mutate: setDefault, isPending: isSettingDefault } = useSetDefaultPaymentMethod();

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
      setSetupError({
        title: 'Setup failed',
        message: msg,
        recoverability: 'retry',
        action: 'Please try again.',
      });
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

  const handleSetupRecoverableError = useCallback(() => {
    setIsRecoverable(true);
  }, []);

  const handleRetrySetup = useCallback(() => {
    setSetupError(null);
    setIsRecoverable(false);
  }, []);

  if (!customerId) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Payment Methods</h1>
          <p className="text-gray-500 mt-1">Manage your saved payment methods</p>
        </div>
        <div className="card">
          <p className="text-gray-500 text-center py-8">
            Payment methods are customer-specific.{' '}
            <Link href="/checkout" className="text-primary-600 hover:underline">
              Make a payment
            </Link>{' '}
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
          <h1 className="text-3xl font-bold text-gray-900">Payment Methods</h1>
          <p className="text-gray-500 mt-1">Manage your saved payment methods</p>
        </div>
        {!addingNew && (
          <button onClick={handleAddNew} className="btn-primary">
            Add Payment Method
          </button>
        )}
      </div>

      {setupError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-sm">{setupError.title}</p>
              <p className="text-sm mt-1">{setupError.message}</p>
              {setupError.action && (
                <p className="text-xs mt-1 text-red-600">{setupError.action}</p>
              )}
            </div>
            {isRecoverable && (
              <button
                onClick={handleRetrySetup}
                className="shrink-0 text-sm font-semibold text-red-700 hover:text-red-900 underline underline-offset-2"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {addingNew && setupClientSecret && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Payment Method</h2>
          <StripeProvider clientSecret={setupClientSecret} mode="setup">
            <SetupForm
              onSuccess={handleSetupSuccess}
              onError={handleSetupError}
              onRecoverableError={handleSetupRecoverableError}
            />
          </StripeProvider>
          <button
            onClick={() => {
              setAddingNew(false);
              setSetupClientSecret(null);
              setSetupError(null);
              setIsRecoverable(false);
            }}
            className="mt-3 text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}

      {isPending || isFetching ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="card animate-pulse flex items-center gap-4">
              <div className="h-8 w-12 bg-gray-200 rounded" />
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : paymentMethods.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          No saved payment methods. Click &quot;Add Payment Method&quot; to save one.
        </div>
      ) : (
        <div className="space-y-3">
          {paymentMethods.map((pm) => {
            const label = getPaymentMethodLabel(pm);
            const subtitle = getPaymentMethodSubtitle(pm);
            return (
              <div
                key={pm.id}
                className={`card flex items-center gap-4 ${pm.isDefault ? 'ring-2 ring-primary-500' : ''}`}
              >
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 whitespace-nowrap">
                  {pm.type === 'card' && pm.brand
                    ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)
                    : pm.type.replace(/_/g, ' ')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {label}
                    {pm.isDefault && (
                      <span className="ml-2 text-xs text-primary-600 font-semibold">Default</span>
                    )}
                  </p>
                  {subtitle && (
                    <p className="text-sm text-gray-500">{subtitle}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {!pm.isDefault && (
                    <button
                      onClick={() => setDefault({ id: pm.id, customerId })}
                      disabled={isSettingDefault}
                      className="text-sm text-primary-600 hover:text-primary-800 disabled:opacity-50"
                    >
                      Set default
                    </button>
                  )}
                  <button
                    onClick={() => detach({ id: pm.id, customerId })}
                    disabled={isDetaching}
                    className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
