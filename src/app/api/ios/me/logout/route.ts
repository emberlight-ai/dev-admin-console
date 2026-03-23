import { NextRequest, NextResponse } from 'next/server';
import { getUserSupabase } from '@/lib/ios-user-supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Logout endpoint (server-side helper):
 * - Deletes the provided device push token for the authenticated user.
 * - Best-effort calls Supabase `auth.signOut()` (client should still clear local session).
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);

    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      // Allow empty body; token removal will be skipped.
    }

    const token =
      body && typeof body === 'object' && 'token' in body
        ? (body as { token?: unknown }).token
        : undefined;
    const platform =
      body && typeof body === 'object' && 'platform' in body
        ? (body as { platform?: unknown }).platform
        : undefined;

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonError(userErr?.message || 'Unauthorized', 401);
    }
    const userId = userData.user.id;

    // Remove push token for this device (if provided).
    if (typeof token === 'string' && token.length > 0) {
      let q = supabase.from('user_push_tokens').delete().eq('user_id', userId).eq('token', token);
      if (typeof platform === 'string' && platform.length > 0) {
        q = q.eq('platform', platform);
      }
      const { error: delErr } = await q;
      if (delErr) return jsonError(delErr.message, 500);
    }

    // Best effort. Client should still clear local session.
    await supabase.auth.signOut();

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

