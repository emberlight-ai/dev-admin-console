import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST {match_id, muted} — mute/unmute the digital human for one conversation.
 * While muted, dh-auto-reply skips the match and dh-followup never re-engages
 * it (user_match_ai_state.dh_muted). Used by the per-conversation toggle on the
 * user detail chat-history rail; rpc_set_user_cooldown flips the same flag in
 * bulk on cooldown entry/exit.
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let matchId: string;
  let muted: boolean;
  try {
    const body = await req.json();
    if (typeof body?.match_id !== 'string' || !body.match_id) return jsonError('match_id is required', 400);
    if (typeof body?.muted !== 'boolean') return jsonError('muted (boolean) is required', 400);
    matchId = body.match_id;
    muted = body.muted;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { data, error } = await supabaseAdmin
    .from('user_match_ai_state')
    .update({ dh_muted: muted })
    .eq('match_id', matchId)
    .select('match_id, dh_muted')
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError('No ai state row for match', 404);

  return NextResponse.json({ state: data });
}
