import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function expectedAdminSessionValue() {
  const u = process.env.ADMIN_USERNAME ?? '';
  const p = process.env.ADMIN_PASSWORD ?? '';
  return await sha256Hex(`${u}:${p}`);
}

export async function middleware(request: NextRequest) {
  // Only protect /admin routes
  if (request.nextUrl.pathname.startsWith('/admin')) {
    const adminSession = request.cookies.get('admin_session')?.value;

    const expected = await expectedAdminSessionValue();

    if (!adminSession || adminSession !== expected) {
      // Behind reverse proxies, Next's request.url can end up as localhost.
      // Build the redirect origin explicitly from forwarded headers.
      const proto = request.headers.get('x-forwarded-proto') ?? 'http';
      const host =
        request.headers.get('x-forwarded-host') ??
        request.headers.get('host') ??
        'localhost';

      const res = NextResponse.redirect(new URL('/login', `${proto}://${host}`));
      // Clear stale cookie (e.g. after redeploy with new creds)
      res.cookies.delete('admin_session');
      return res;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/admin/:path*',
};

