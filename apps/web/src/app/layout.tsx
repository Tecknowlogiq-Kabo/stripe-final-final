import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/providers/QueryProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { cookies } from 'next/headers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Stripe Console',
  description: 'Stripe Payment Admin Console',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAuthenticated = !!cookies().get('auth_token')?.value;

  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} bg-zinc-950 text-zinc-100 antialiased`}>
        <QueryProvider>
          {isAuthenticated ? (
            <>
              <Sidebar />
              <div className="ml-60 min-h-screen">
                <main className="p-8 max-w-6xl">{children}</main>
              </div>
            </>
          ) : (
            <main className="min-h-screen bg-zinc-950">{children}</main>
          )}
        </QueryProvider>
      </body>
    </html>
  );
}
