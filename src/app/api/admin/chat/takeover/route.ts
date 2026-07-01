import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// GET — current takeover state for a match. Also returns the authoritative
// dh_user_id / real_user_id so the dock knows which side to operate as.
// user_match_ai_state is not readable by the anon client (RLS), so the admin
// console reads it through the service-role key here.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const matchId = req.nextUrl.searchParams.get('match_id');
  if (!matchId) return jsonError('Missing match_id', 400);

  const { data, error } = await supabaseAdmin
    .from('user_match_ai_state')
    .select('match_id, human_takeover, human_takeover_at, dh_user_id, real_user_id')
    .eq('match_id', matchId)
    .maybeSingle();
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ state: data ?? null });
}

// POST — engage/release human takeover for a match. While engaged, dh-auto-reply
// skips this conversation (see supabase/functions/dh-auto-reply/index.ts step 3b).
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  try {
    const body = await req.json();
    const matchId = typeof body?.match_id === 'string' && body.match_id.length > 0 ? body.match_id : null;
    const active = Boolean(body?.active);
    if (!matchId) return jsonError('Missing match_id', 400);

    const { data, error } = await supabaseAdmin
      .from('user_match_ai_state')
      .update({
        human_takeover: active,
        human_takeover_at: active ? new Date().toISOString() : null,
      })
      .eq('match_id', matchId)
      .select('match_id, human_takeover, human_takeover_at, dh_user_id, real_user_id')
      .maybeSingle();
    if (error) return jsonError(error.message, 500);
    if (!data) {
      return jsonError('No AI state for this match (takeover only applies to digital-human chats)', 404);
    }

    return NextResponse.json({ ok: true, state: data });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
}
