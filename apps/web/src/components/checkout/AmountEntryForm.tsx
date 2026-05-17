'use client';

import { useState, type FormEvent } from 'react';

interface AmountEntryFormProps {
  onSubmit: (data: { amount: number; currency: string; savePaymentMethod: boolean }) => void;
  isLoading: boolean;
  defaultAmount?: number;
  defaultCurrency?: string;
}

const CURRENCIES = [
  { code: 'usd', label: 'USD ($)' },
  { code: 'eur', label: 'EUR (\u20AC)' },
  { code: 'gbp', label: 'GBP (\u00A3)' },
  { code: 'cad', label: 'CAD ($)' },
  { code: 'aud', label: 'AUD ($)' },
  { code: 'jpy', label: 'JPY (\u00A5)' },
];

const ZERO_DECIMAL_CURRENCIES = new Set(['jpy']);

export function AmountEntryForm({
  onSubmit,
  isLoading,
  defaultAmount,
  defaultCurrency = 'usd',
}: AmountEntryFormProps) {
  const isZeroDecimal = defaultCurrency ? ZERO_DECIMAL_CURRENCIES.has(defaultCurrency) : false;
  const initialDisplay = defaultAmount
    ? isZeroDecimal
      ? String(defaultAmount)
      : (defaultAmount / 100).toFixed(2)
    : '';

  const [displayAmount, setDisplayAmount] = useState(initialDisplay);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [savePaymentMethod, setSavePaymentMethod] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const parsed = parseFloat(displayAmount);
    if (isNaN(parsed) || parsed <= 0) {
      setValidationError('Please enter a valid amount.');
      return;
    }

    const isZero = ZERO_DECIMAL_CURRENCIES.has(currency);
    const amountInCents = isZero ? Math.round(parsed) : Math.round(parsed * 100);
    const minAmount = isZero ? 50 : 50; // Stripe minimum is 50 cents / 50 units

    if (amountInCents < minAmount) {
      setValidationError(isZero ? 'Minimum amount is 50.' : 'Minimum amount is $0.50.');
      return;
    }

    onSubmit({ amount: amountInCents, currency, savePaymentMethod });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="amount" className="block text-sm font-medium text-zinc-300 mb-1.5">
          Amount
        </label>
        <div className="flex gap-2">
          <input
            id="amount"
            type="number"
            step={ZERO_DECIMAL_CURRENCIES.has(currency) ? '1' : '0.01'}
            min="0"
            inputMode="decimal"
            placeholder={ZERO_DECIMAL_CURRENCIES.has(currency) ? '1000' : '0.00'}
            value={displayAmount}
            onChange={(e) => { setDisplayAmount(e.target.value); setValidationError(null); }}
            className="input-field flex-1 text-lg tabular-nums"
            autoFocus
            disabled={isLoading}
          />
          <select
            value={currency}
            onChange={(e) => { setCurrency(e.target.value); setValidationError(null); }}
            className="input-field w-32 shrink-0"
            disabled={isLoading}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>
        {validationError && (
          <p className="text-red-400 text-xs mt-1.5">{validationError}</p>
        )}
      </div>

      <label className="flex items-center gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={savePaymentMethod}
          onChange={(e) => setSavePaymentMethod(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
          disabled={isLoading}
        />
        <div>
          <span className="text-sm text-zinc-200 group-hover:text-zinc-100">
            Save payment method for future use
          </span>
          <p className="text-xs text-zinc-500 mt-0.5">
            Securely store your payment details for faster checkout next time
          </p>
        </div>
      </label>

      <button
        type="submit"
        disabled={isLoading || !displayAmount}
        className="btn-primary w-full"
      >
        {isLoading ? 'Creating payment...' : 'Continue to Payment'}
      </button>
    </form>
  );
}
