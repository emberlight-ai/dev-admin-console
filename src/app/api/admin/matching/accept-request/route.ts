import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Admin-only: accept a pending match_request on behalf of a digital human.
 *
 * Used when a real user has right-swiped a DH and the admin wants to manually
 * accept (instead of waiting for the random `process_digital_human_requests`
 * cron job to decide). Refuses to act on a request where the target is a real
 * user — those should be accepted by the real user themselves.
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let body: { match_request_id?: unknown };
  try {
    body = (await req.json()) as { match_request_id?: unknown };
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const match_request_id =
    typeof body.match_request_id === 'string' && body.match_request_id.length > 0
      ? body.match_request_id
      : null;
  if (!match_request_id) return jsonError('Missing match_request_id', 400);

  // Load the request
  const { data: reqRow, error: reqErr } = await supabaseAdmin
    .from('match_requests')
    .select('id,from_user_id,to_user_id')
    .eq('id', match_request_id)
    .maybeSingle();
  if (reqErr) return jsonError(reqErr.message, 500);
  if (!reqRow) return jsonError('Match request not found', 404);

  // Verify target is a digital human — that's the whole point of this endpoint.
  const { data: toUser, error: toUserErr } = await supabaseAdmin
    .from('users')
    .select('userid,is_digital_human,deleted_at')
    .eq('userid', reqRow.to_user_id)
    .maybeSingle();
  if (toUserErr) return jsonError(toUserErr.message, 500);
  if (!toUser || toUser.deleted_at) return jsonError('Target user not found', 404);
  if (!toUser.is_digital_human) {
    return jsonError('Can only accept on behalf of a digital human', 400);
  }

  // Canonicalize user_matches ordering (matches existing send-match-request convention).
  const user_a =
    reqRow.from_user_id < reqRow.to_user_id ? reqRow.from_user_id : reqRow.to_user_id;
  const user_b =
    reqRow.from_user_id < reqRow.to_user_id ? reqRow.to_user_id : reqRow.from_user_id;

  // Create the match BEFORE deleting the request. These are two separate,
  // non-transactional network calls, so order is the only safety we have:
  //   - If the upsert fails, the pending request is still intact → admin retries.
  //   - If the delete fails after a successful upsert, the match exists and the
  //     stale request is harmless; the upsert's idempotency makes a retry safe.
  // (Deleting first would permanently lose the request on an insert failure.)
  // `upsert` on the (user_a, user_b) unique constraint also absorbs the race
  // where the match was created between our checks.
  const { data: match, error: matchErr } = await supabaseAdmin
    .from('user_matches')
    .upsert({ user_a, user_b }, { onConflict: 'user_a,user_b' })
    .select('id')
    .single();
  if (matchErr) return jsonError(matchErr.message, 500);

  const { error: delErr } = await supabaseAdmin
    .from('match_requests')
    .delete()
    .eq('id', match_request_id);
  if (delErr) return jsonError(delErr.message, 500);

  return NextResponse.json({ match_id: match.id });
}
