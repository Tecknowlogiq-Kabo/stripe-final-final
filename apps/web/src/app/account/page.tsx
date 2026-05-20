'use client';

import { useState, useEffect } from 'react';
import { useMyCustomer, useCreateCustomer, useUpdateCustomer } from '@/features/customers/customers.hooks';
import { getErrorMessage } from '@/lib/rtk-errors';

function isNotFound(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    return (error as { status: number }).status === 404;
  }
  return false;
}

export default function AccountPage() {
  const { data: customer, isError, error, isLoading } = useMyCustomer();
  const noCustomer = isError && isNotFound(error);

  if (isLoading) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="page-title">Account</h1>
          <p className="page-subtitle">Billing profile</p>
        </div>
        <div className="card max-w-lg animate-pulse space-y-4">
          <div className="h-4 bg-zinc-800 rounded w-1/3" />
          <div className="h-9 bg-zinc-800/60 rounded" />
          <div className="h-4 bg-zinc-800 rounded w-1/4 mt-4" />
          <div className="h-9 bg-zinc-800/60 rounded" />
        </div>
      </div>
    );
  }

  if (isError && !noCustomer) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="page-title">Account</h1>
        </div>
        <div className="alert-error max-w-lg">
          Failed to load account. Make sure the API is running.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="page-title">Account</h1>
        <p className="page-subtitle">Billing profile</p>
      </div>
      {noCustomer ? <CreateCustomerForm /> : customer && <EditCustomerForm customer={customer} />}
    </div>
  );
}

function CreateCustomerForm() {
  const [create, { isLoading, error }] = useCreateCustomer();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create({ email, name: name || undefined, phone: phone || undefined });
  };

  return (
    <div className="card max-w-lg">
      <h2 className="text-base font-semibold text-zinc-100 mb-1">Set up billing profile</h2>
      <p className="text-sm text-zinc-500 mb-6">
        Create a customer record to manage subscriptions and payment methods.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-zinc-400 mb-1.5">
            Email <span className="text-red-400">*</span>
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input-field"
          />
        </div>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-zinc-400 mb-1.5">
            Name <span className="text-zinc-600 font-normal">(optional)</span>
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            className="input-field"
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-zinc-400 mb-1.5">
            Phone <span className="text-zinc-600 font-normal">(optional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 000 0000"
            className="input-field"
          />
        </div>
        {error && <p className="text-sm text-red-400">{getErrorMessage(error)}</p>}
        <button type="submit" disabled={isLoading} className="btn-primary w-full">
          {isLoading ? 'Creating…' : 'Create billing profile'}
        </button>
      </form>
    </div>
  );
}

function EditCustomerForm({ customer }: { customer: { id: string; email: string; name?: string; phone?: string } }) {
  const [update, { isLoading, error, isSuccess }] = useUpdateCustomer();
  const [name, setName] = useState(customer.name ?? '');
  const [phone, setPhone] = useState(customer.phone ?? '');

  useEffect(() => {
    setName(customer.name ?? '');
    setPhone(customer.phone ?? '');
  }, [customer.name, customer.phone]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update({ id: customer.id, name: name || undefined, phone: phone || undefined });
  };

  return (
    <div className="card max-w-lg">
      <h2 className="text-base font-semibold text-zinc-100 mb-6">Billing profile</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">Email</label>
          <input
            type="email"
            value={customer.email}
            readOnly
            className="input-readonly w-full"
          />
          <p className="text-xs text-zinc-600 mt-1">Email cannot be changed here</p>
        </div>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-zinc-400 mb-1.5">Name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            className="input-field"
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-zinc-400 mb-1.5">Phone</label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 000 0000"
            className="input-field"
          />
        </div>
        {error && <p className="text-sm text-red-400">{getErrorMessage(error)}</p>}
        {isSuccess && <p className="text-sm text-green-400">Profile updated.</p>}
        <button type="submit" disabled={isLoading} className="btn-primary">
          {isLoading ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}
