import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { analyzePerformance, normalizePerfRow } from '@/lib/whitelist-performance';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type Changed = { userid: string; username: string | null; personality: string | null; likeRate: number | null; total: number };

// POST — apply the suggested whitelist changes: demote underperforming whitelisted
// DHs and promote proven non-whitelisted ones. Suggestions are recomputed
// server-side (same logic as the review GET) so a stale client can't apply an
// arbitrary set. Updates by userid; the whitelisted guard keeps it idempotent.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  // Optional gender scope so a Female/Male-filtered review only applies that
  // gender's suggestions. No body / other value = apply across both genders.
  let gender: 'Female' | 'Male' | null = null;
  try {
    const body = (await req.json()) as { gender?: unknown };
    if (body?.gender === 'Female' || body?.gender === 'Male') gender = body.gender;
  } catch {
    /* no body */
  }

  const { data, error } = await supabaseAdmin.rpc('rpc_admin_dh_swipe_performance');
  if (error) return jsonError(error.message, 500);

  let rows = ((data ?? []) as Array<Record<string, unknown>>).map(normalizePerfRow);
  if (gender) rows = rows.filter((r) => (r.gender ?? '').toLowerCase() === gender.toLowerCase());
  const { suggestions } = analyzePerformance(rows);

  const pick = (r: (typeof suggestions.demote)[number]): Changed => ({
    userid: r.userid,
    username: r.username,
    personality: r.personality,
    likeRate: r.likeRate,
    total: r.total,
  });

  const demoteIds = suggestions.demote.map((r) => r.userid);
  const promoteIds = suggestions.promote.map((r) => r.userid);

  if (demoteIds.length) {
    const { error: e } = await supabaseAdmin
      .from('users')
      .update({ whitelisted: false })
      .in('userid', demoteIds)
      .eq('whitelisted', true);
    if (e) return jsonError(`Demote failed: ${e.message}`, 500);
  }

  if (promoteIds.length) {
    const { error: e } = await supabaseAdmin
      .from('users')
      .update({ whitelisted: true })
      .in('userid', promoteIds)
      .eq('whitelisted', false);
    if (e) return jsonError(`Promote failed: ${e.message}`, 500);
  }

  return NextResponse.json({
    demoted: suggestions.demote.map(pick),
    promoted: suggestions.promote.map(pick),
  });
}
