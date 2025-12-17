'use server';

import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

const SESSION_COOKIE_NAME = 'admin_session';

export async function login(formData: FormData) {
  const username = formData.get('username') as string;
  const password = formData.get('password') as string;

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const cookieStore = await cookies();
    const headerStore = await headers();
    const proto = headerStore.get('x-forwarded-proto') ?? 'http';
    const isSecure = proto === 'https';

    cookieStore.set(SESSION_COOKIE_NAME, 'true', {
      httpOnly: true,
      // Respect TLS termination in front of Next (e.g. Nginx/Cloudflare).
      // If users hit plain http://, a Secure cookie will not be stored/sent and
      // middleware will bounce them back to /login on subsequent navigations.
      secure: isSecure,
      // Lax is sufficient here and is more robust across typical navigation flows.
      sameSite: 'lax',
      path: '/',
      // Persist a bit so refreshes / new tabs don't unexpectedly log you out.
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    redirect('/admin/users');
  } else {
    return { error: 'Invalid credentials' };
  }
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect('/');
}

export async function isLoggedIn() {
  const cookieStore = await cookies();
  return cookieStore.has(SESSION_COOKIE_NAME);
}
