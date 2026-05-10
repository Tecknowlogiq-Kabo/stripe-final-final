import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/providers/QueryProvider';
import { cookies } from 'next/headers';
import { logoutAction } from '@/actions/auth';

export const metadata: Metadata = {
  title: 'Stripe Integration',
  description: 'Production NestJS + Next.js Stripe Payment Integration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAuthenticated = !!cookies().get('auth_token')?.value;

  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <QueryProvider>
          <nav className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="max-w-4xl mx-auto flex items-center justify-between">
              <a href="/" className="text-xl font-bold text-primary-600">
                StripeApp
              </a>
              <div className="flex items-center gap-6 text-sm font-medium text-gray-600">
                {isAuthenticated ? (
                  <>
                    <a href="/checkout" className="hover:text-primary-600">Checkout</a>
                    <a href="/payments" className="hover:text-primary-600">Payments</a>
                    <a href="/subscriptions" className="hover:text-primary-600">Subscriptions</a>
                    <a href="/payment-methods" className="hover:text-primary-600">Payment Methods</a>
                    <a href="/account" className="hover:text-primary-600">Account</a>
                    <form action={logoutAction}>
                      <button type="submit" className="hover:text-red-600 transition-colors">
                        Sign out
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <a href="/auth/login" className="hover:text-primary-600">Sign in</a>
                    <a href="/auth/register" className="btn-primary text-sm px-4 py-2">
                      Register
                    </a>
                  </>
                )}
              </div>
            </div>
          </nav>
          <main className="max-w-4xl mx-auto px-6 py-10">{children}</main>
        </QueryProvider>
      </body>
    </html>
  );
}
