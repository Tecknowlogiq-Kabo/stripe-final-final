import type { Metadata } from 'next';
import './globals.css';
import { StoreProvider } from '@/providers/StoreProvider';

export const metadata: Metadata = {
  title: 'Stripe Integration',
  description: 'Production NestJS + Next.js Stripe Payment Integration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <StoreProvider>
          <nav className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="max-w-4xl mx-auto flex items-center justify-between">
              <a href="/" className="text-xl font-bold text-primary-600">
                StripeApp
              </a>
              <div className="flex gap-6 text-sm font-medium text-gray-600">
                <a href="/checkout" className="hover:text-primary-600">Checkout</a>
                <a href="/subscriptions" className="hover:text-primary-600">Subscriptions</a>
                <a href="/payment-methods" className="hover:text-primary-600">Payment Methods</a>
              </div>
            </div>
          </nav>
          <main className="max-w-4xl mx-auto px-6 py-10">{children}</main>
        </StoreProvider>
      </body>
    </html>
  );
}
