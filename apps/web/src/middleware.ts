import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicPaths = ['/', '/auth/login', '/auth/register'];
const publicPathPrefixes = ['/trust/'];
const authPaths = ['/auth/login', '/auth/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authToken = request.cookies.get('auth_token')?.value;

  const isPublic = publicPaths.some((p) => pathname === p);
  const isPublicPrefix = publicPathPrefixes.some((p) => pathname.startsWith(p));
  const isAuthPage = authPaths.some((p) => pathname === p);

  // Allow public routes, trustId guest links, static assets, and Next.js internals
  if (isPublic || isPublicPrefix || pathname.startsWith('/_next') || pathname.startsWith('/api')) {
    // Redirect authenticated users away from auth pages
    if (isAuthPage && authToken) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // Protected routes — require auth_token cookie
  if (!authToken) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
