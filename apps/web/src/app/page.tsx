export default function HomePage() {
  return (
    <div className="text-center py-20">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">
        Stripe Integration Demo
      </h1>
      <p className="text-gray-600 mb-8">
        Production-ready NestJS + Next.js Stripe integration
      </p>
      <div className="flex justify-center gap-4">
        <a href="/checkout" className="btn-primary inline-block w-auto px-8">
          Try Checkout
        </a>
        <a
          href="/subscriptions"
          className="border border-primary-600 text-primary-600 px-8 py-3 rounded-lg font-semibold hover:bg-primary-50 transition-colors"
        >
          View Plans
        </a>
      </div>
    </div>
  );
}
