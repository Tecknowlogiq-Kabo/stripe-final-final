'use client';

import { useState, useEffect } from 'react';
import { useMyCustomer, useCreateCustomer, useUpdateCustomer } from '@/features/customers/customers.hooks';
import { ApiError } from '@/lib/api-client';

export default function AccountPage() {
  const { data: customer, isError, error, isPending } = useMyCustomer();

  const noCustomer = isError && error instanceof ApiError && (error as ApiError).status === 404;

  if (isPending) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Account</h1>
          <p className="text-gray-500 mt-1">Your billing profile</p>
        </div>
        <div className="card animate-pulse space-y-4">
          <div className="h-5 bg-gray-200 rounded w-1/3" />
          <div className="h-10 bg-gray-100 rounded" />
          <div className="h-5 bg-gray-200 rounded w-1/4 mt-4" />
          <div className="h-10 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (isError && !noCustomer) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Account</h1>
        </div>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          Failed to load account. Make sure the API is running.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Account</h1>
        <p className="text-gray-500 mt-1">Your billing profile</p>
      </div>
      {noCustomer ? (
        <CreateCustomerForm />
      ) : (
        customer && <EditCustomerForm customer={customer} />
      )}
    </div>
  );
}

// ── Create ────────────────────────────────────────────────────────────────────

function CreateCustomerForm() {
  const { mutate: create, isPending, error } = useCreateCustomer();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create({ email, name: name || undefined, phone: phone || undefined });
  };

  return (
    <div className="card max-w-lg">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Set up billing profile</h2>
      <p className="text-sm text-gray-500 mb-6">
        Create a customer record to manage subscriptions and payment methods.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Name <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            Phone <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 000 0000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {error && (
          <p className="text-sm text-red-600">{error.message}</p>
        )}
        <button type="submit" disabled={isPending} className="btn-primary w-full">
          {isPending ? 'Creating…' : 'Create billing profile'}
        </button>
      </form>
    </div>
  );
}

// ── Edit ──────────────────────────────────────────────────────────────────────

function EditCustomerForm({ customer }: { customer: { id: string; email: string; name?: string; phone?: string } }) {
  const { mutate: update, isPending, error, isSuccess } = useUpdateCustomer();
  const [name, setName] = useState(customer.name ?? '');
  const [phone, setPhone] = useState(customer.phone ?? '');

  // Reset fields when customer data changes (e.g. after a successful save)
  useEffect(() => {
    setName(customer.name ?? '');
    setPhone(customer.phone ?? '');
  }, [customer.name, customer.phone]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update({
      id: customer.id,
      name: name || undefined,
      phone: phone || undefined,
    });
  };

  return (
    <div className="card max-w-lg">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">Billing profile</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={customer.email}
            readOnly
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
          />
          <p className="text-xs text-gray-400 mt-1">Email cannot be changed here</p>
        </div>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 000 0000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {error && (
          <p className="text-sm text-red-600">{error.message}</p>
        )}
        {isSuccess && (
          <p className="text-sm text-green-600">Profile updated.</p>
        )}
        <button type="submit" disabled={isPending} className="btn-primary">
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}
