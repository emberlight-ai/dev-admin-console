import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function asUuid(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Admin-only: force a match between a real user and a digital human.
 *
 * Works by (user_id, dh_id) pair rather than a specific match_request id, so it
 * applies whether the user's request is still pending OR was already deleted by
 * the `process_digital_human_requests` cron (which rejects ~70% of requests and
 * removes them). Direction-agnostic: covers both a user's right swipe toward a
 * DH and a DH's inbound invite to the user — either way the admin creates the
 * match immediately so people get connected ASAP.
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let body: { user_id?: unknown; dh_id?: unknown };
  try {
    body = (await req.json()) as { user_id?: unknown; dh_id?: unknown };
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const user_id = asUuid(body.user_id);
  const dh_id = asUuid(body.dh_id);
  if (!user_id) return jsonError('Missing user_id', 400);
  if (!dh_id) return jsonError('Missing dh_id', 400);
  if (user_id === dh_id) return jsonError('user_id and dh_id must differ', 400);

  // Validate both participants: the real user must be a real user, and the DH
  // must actually be a digital human. This is what keeps the endpoint from
  // being misused to force-match two real users behind their backs.
  const [{ data: user, error: userErr }, { data: dh, error: dhErr }] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('userid,is_digital_human,deleted_at')
      .eq('userid', user_id)
      .maybeSingle(),
    supabaseAdmin
      .from('users')
      .select('userid,is_digital_human,deleted_at')
      .eq('userid', dh_id)
      .maybeSingle(),
  ]);
  if (userErr) return jsonError(userErr.message, 500);
  if (dhErr) return jsonError(dhErr.message, 500);
  if (!user || user.deleted_at) return jsonError('User not found', 404);
  if (!dh || dh.deleted_at) return jsonError('Digital human not found', 404);
  if (user.is_digital_human) return jsonError('user_id must be a real user', 400);
  if (!dh.is_digital_human) return jsonError('dh_id must be a digital human', 400);

  // Respect blocks in either direction.
  const { data: blockRow, error: blockErr } = await supabaseAdmin
    .from('blocks')
    .select('id')
    .or(
      `and(blocker_id.eq.${user_id},blocked_id.eq.${dh_id}),and(blocker_id.eq.${dh_id},blocked_id.eq.${user_id})`
    )
    .limit(1)
    .maybeSingle();
  if (blockErr) return jsonError(blockErr.message, 500);
  if (blockRow) return jsonError('cannot match: one of the users has blocked the other', 400);

  const user_a = user_id < dh_id ? user_id : dh_id;
  const user_b = user_id < dh_id ? dh_id : user_id;

  // Create the match BEFORE clearing any pending requests. These are separate,
  // non-transactional calls, so order is the only safety we have:
  //   - If the upsert fails, any pending request is left intact → admin retries.
  //   - If the request delete fails after a successful upsert, the match exists
  //     and the leftover request is harmless (and a retry is idempotent).
  // `upsert` on the (user_a, user_b) unique index also absorbs the race where
  // the match was created between our checks.
  const { data: match, error: matchErr } = await supabaseAdmin
    .from('user_matches')
    .upsert({ user_a, user_b }, { onConflict: 'user_a,user_b' })
    .select('id')
    .single();
  if (matchErr) return jsonError(matchErr.message, 500);

  // Clear any pending requests in either direction so the relationship view
  // doesn't show a stale "pending" alongside the new match.
  const { error: delErr } = await supabaseAdmin
    .from('match_requests')
    .delete()
    .or(
      `and(from_user_id.eq.${user_id},to_user_id.eq.${dh_id}),and(from_user_id.eq.${dh_id},to_user_id.eq.${user_id})`
    );
  if (delErr) return jsonError(delErr.message, 500);

  return NextResponse.json({ match_id: match.id });
}
