import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Broadcast a DH "typing" indicator so the real user's app shows "Typing…" while
// an admin operator writes in the takeover dock. This mirrors dh-auto-reply's
// broadcastTyping exactly (topic `chat:{matchId}`, event `typing`, payload
// { user_id, typing }) so the iOS client treats it identically to the bot. The
// service-role key can't live in the browser, so the dock pings this route.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  try {
    const body = await req.json();
    const matchId = typeof body?.match_id === 'string' && body.match_id.length > 0 ? body.match_id : null;
    const dhUserId = typeof body?.dh_user_id === 'string' && body.dh_user_id.length > 0 ? body.dh_user_id : null;
    const typing = Boolean(body?.typing);
    if (!matchId || !dhUserId) return jsonError('Missing match_id or dh_user_id', 400);

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return jsonError('Realtime broadcast is not configured', 500);

    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `chat:${matchId.toLowerCase()}`,
            event: 'typing',
            payload: { user_id: dhUserId, typing },
            private: false,
          },
        ],
      }),
    });
    if (!res.ok) return jsonError(`Broadcast failed: ${res.status}`, 502);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
}
