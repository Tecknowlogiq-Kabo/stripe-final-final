import Link from 'next/link';

export default function PaymentMethodsPage() {
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
