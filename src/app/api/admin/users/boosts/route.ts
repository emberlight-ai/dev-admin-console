import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type BoostStatus = {
  boosted: boolean;   // has ever activated a boost
  boosting: boolean;  // a boost is active right now (within its 15-min window)
  boost_count: number;
  last_expires_at: string | null;
};

/**
 * GET — boost status per user, as a map of userid -> {boosted, boosting, ...}.
 * Feeds the Boost column on /admin/users (same pattern as the match/message/
 * image count endpoints). "boosting" is derived from last_expires_at vs now, so
 * it stays accurate without any cron — the ledger is never mutated.
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data, error } = await supabaseAdmin.rpc('rpc_admin_user_boosts');
  if (error) return jsonError(error.message, 500);

  const now = Date.now();
  const map: Record<string, BoostStatus> = {};
  for (const r of (data ?? []) as Array<{ user_id: string; boost_count: number | string; last_expires_at: string | null }>) {
    if (!r.user_id) continue;
    const lastExpires = r.last_expires_at ? new Date(r.last_expires_at).getTime() : 0;
    map[r.user_id] = {
      boosted: true,
      boosting: lastExpires > now,
      boost_count: Number(r.boost_count ?? 0),
      last_expires_at: r.last_expires_at,
    };
  }

  return NextResponse.json({ data: map });
}
