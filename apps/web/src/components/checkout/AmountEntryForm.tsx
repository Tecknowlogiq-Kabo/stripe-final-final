'use client';

import { useState, type FormEvent } from 'react';

interface AmountEntryFormProps {
  onSubmit: (data: {
    amount: number;
    currency: string;
    paymentMethodType: string;
    savePaymentMethod: boolean;
  }) => void;
  isLoading: boolean;
}

const PAYMENT_TYPES = [
  { type: 'card', label: 'Card', currency: 'gbp', icon: '💳' },
  { type: 'bancontact', label: 'Bancontact', currency: 'eur', icon: '🏦' },
  { type: 'eps', label: 'EPS', currency: 'eur', icon: '🏧' },
  { type: 'p24', label: 'Przelewy24', currency: 'eur', icon: '🏦' },
  { type: 'sepa_debit', label: 'SEPA Direct Debit', currency: 'eur', icon: '🇪🇺' },
  { type: 'us_bank_account', label: 'ACH Bank Transfer', currency: 'usd', icon: '🇺🇸' },
  { type: 'bacs_debit', label: 'BACS Direct Debit', currency: 'gbp', icon: '🇬🇧' },
  { type: 'au_becs_debit', label: 'BECS Direct Debit', currency: 'aud', icon: '🇦🇺' },
  { type: 'link', label: 'Link', currency: 'gbp', icon: '🔗' },
  { type: 'amazon_pay', label: 'Amazon Pay', currency: 'gbp', icon: '📦' },
  { type: 'revolut_pay', label: 'Revolut Pay', currency: 'gbp', icon: '💸' },
] as const;

const ZERO_DECIMAL_CURRENCIES = new Set(['jpy']);

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: '$', eur: '€', gbp: '£', aud: 'A$', cad: 'C$', jpy: '¥',
};

export function AmountEntryForm({ onSubmit, isLoading }: AmountEntryFormProps) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [displayAmount, setDisplayAmount] = useState('');
  const [savePaymentMethod, setSavePaymentMethod] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const selectedPayment = PAYMENT_TYPES.find((p) => p.type === selectedType);
  const currency = selectedPayment?.currency ?? 'usd';
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency.toUpperCase();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!selectedType) {
      setValidationError('Please select a payment method.');
      return;
    }

    const parsed = parseFloat(displayAmount);
    if (isNaN(parsed) || parsed <= 0) {
      setValidationError('Please enter a valid amount.');
      return;
    }

    const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
    const amountInCents = isZeroDecimal ? Math.round(parsed) : Math.round(parsed * 100);

    if (amountInCents < 50) {
      setValidationError(isZeroDecimal ? 'Minimum amount is 50.' : `Minimum amount is ${symbol}0.50.`);
      return;
    }

    onSubmit({
      amount: amountInCents,
      currency,
      paymentMethodType: selectedType,
      savePaymentMethod,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-2">
          Payment Method
        </label>
        <div className="grid grid-cols-2 gap-2">
          {PAYMENT_TYPES.map((pm) => (
            <button
              key={pm.type}
              type="button"
              onClick={() => { setSelectedType(pm.type); setValidationError(null); }}
              disabled={isLoading}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-sm transition-colors ${
                selectedType === pm.type
                  ? 'border-indigo-500 bg-indigo-500/10 text-zinc-100'
                  : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
              }`}
            >
              <span className="text-base">{pm.icon}</span>
              <span className="truncate">{pm.label}</span>
            </button>
          ))}
        </div>
      </div>

      {selectedType && (
        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-zinc-300 mb-1.5">
            Amount
            <span className="ml-2 text-xs text-zinc-500">({currency.toUpperCase()})</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-lg">
              {symbol}
            </span>
            <input
              id="amount"
              type="number"
              step={ZERO_DECIMAL_CURRENCIES.has(currency) ? '1' : '0.01'}
              min="0"
              inputMode="decimal"
              placeholder="0.00"
              value={displayAmount}
              onChange={(e) => { setDisplayAmount(e.target.value); setValidationError(null); }}
              className="input-field text-lg tabular-nums pl-8"
              autoFocus
              disabled={isLoading}
            />
          </div>
        </div>
      )}

      {validationError && (
        <p className="text-red-400 text-xs">{validationError}</p>
      )}

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
        disabled={isLoading || !selectedType || !displayAmount}
        className="btn-primary w-full"
      >
        {isLoading ? 'Creating payment...' : 'Continue to Payment'}
      </button>
    </form>
  );
}
