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

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  try {
    const body = await req.json();
    const from_user_id = asUuid(body?.from_user_id);
    const target_user_id = asUuid(body?.target_user_id);

    if (!from_user_id) return jsonError('Missing required field: from_user_id', 400);
    if (!target_user_id) return jsonError('Missing required field: target_user_id', 400);
    if (from_user_id === target_user_id) return jsonError('cannot match with self', 400);

    // Ensure both users exist and target is a REAL user (per requirement).
    const [{ data: fromUser, error: fromErr }, { data: targetUser, error: targetErr }] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('userid,deleted_at,is_digital_human')
        .eq('userid', from_user_id)
        .maybeSingle(),
      supabaseAdmin
        .from('users')
        .select('userid,deleted_at,is_digital_human')
        .eq('userid', target_user_id)
        .maybeSingle(),
    ]);
    if (fromErr) return jsonError(fromErr.message, 500);
    if (targetErr) return jsonError(targetErr.message, 500);
    if (!fromUser || fromUser.deleted_at) return jsonError('from_user_id not found', 404);
    if (!targetUser || targetUser.deleted_at) return jsonError('target_user_id not found', 404);
    if (targetUser.is_digital_human) return jsonError('target_user_id must be a real user', 400);

    // Block enforcement
    const { data: blockRow, error: blockErr } = await supabaseAdmin
      .from('blocks')
      .select('id')
      .or(
        `and(blocker_id.eq.${from_user_id},blocked_id.eq.${target_user_id}),and(blocker_id.eq.${target_user_id},blocked_id.eq.${from_user_id})`
      )
      .limit(1)
      .maybeSingle();
    if (blockErr) return jsonError(blockErr.message, 500);
    if (blockRow) return jsonError('cannot match: one of the users has blocked the other', 400);

    // If already matched, return existing match id.
    const user_a = from_user_id < target_user_id ? from_user_id : target_user_id;
    const user_b = from_user_id < target_user_id ? target_user_id : from_user_id;

    const { data: existingMatch, error: matchErr } = await supabaseAdmin
      .from('user_matches')
      .select('id')
      .eq('user_a', user_a)
      .eq('user_b', user_b)
      .maybeSingle();
    if (matchErr) return jsonError(matchErr.message, 500);
    if (existingMatch?.id) {
      return NextResponse.json({ type: 'match', id: existingMatch.id });
    }

    // If reciprocal request exists, auto-match.
    const { data: reciprocal, error: recipErr } = await supabaseAdmin
      .from('match_requests')
      .select('id')
      .eq('from_user_id', target_user_id)
      .eq('to_user_id', from_user_id)
      .maybeSingle();
    if (recipErr) return jsonError(recipErr.message, 500);

    if (reciprocal?.id) {
      const { error: delErr } = await supabaseAdmin.from('match_requests').delete().or(
        `and(from_user_id.eq.${from_user_id},to_user_id.eq.${target_user_id}),and(from_user_id.eq.${target_user_id},to_user_id.eq.${from_user_id})`
      );
      if (delErr) return jsonError(delErr.message, 500);

      const { data: insertedMatch, error: insErr } = await supabaseAdmin
        .from('user_matches')
        .insert({ user_a, user_b })
        .select('id')
        .single();
      if (insErr) return jsonError(insErr.message, 500);

      return NextResponse.json({ type: 'match', id: insertedMatch.id });
    }

    // Normal path: create outbound request (idempotent).
    const { data: reqRow, error: reqErr } = await supabaseAdmin
      .from('match_requests')
      .insert({ from_user_id, to_user_id: target_user_id })
      .select('id')
      .maybeSingle();
    if (reqErr) {
      // If unique constraint triggers, fallback to lookup
      const { data: existingReq, error: lookupErr } = await supabaseAdmin
        .from('match_requests')
        .select('id')
        .eq('from_user_id', from_user_id)
        .eq('to_user_id', target_user_id)
        .maybeSingle();
      if (lookupErr) return jsonError(reqErr.message, 500);
      if (!existingReq?.id) return jsonError(reqErr.message, 500);
      return NextResponse.json({ type: 'request', id: existingReq.id });
    }

    if (!reqRow?.id) return jsonError('Failed to create match request', 500);
    return NextResponse.json({ type: 'request', id: reqRow.id });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
}

