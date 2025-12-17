'use server';

import { cookies } from 'next/headers';
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
    cookieStore.set(SESSION_COOKIE_NAME, 'true', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
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
