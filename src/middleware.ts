import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Only protect /admin routes
  if (request.nextUrl.pathname.startsWith('/admin')) {
    const adminSession = request.cookies.get('admin_session');

    if (!adminSession) {
      // Behind reverse proxies, Next's request.url can end up as localhost.
      // Build the redirect origin explicitly from forwarded headers.
      const proto = request.headers.get('x-forwarded-proto') ?? 'http';
      const host =
        request.headers.get('x-forwarded-host') ??
        request.headers.get('host') ??
        'localhost';

      return NextResponse.redirect(new URL('/login', `${proto}://${host}`));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/admin/:path*',
};

