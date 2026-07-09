import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type CooldownStatus = {
  active: boolean;
  reason: string;
  entered_at: string;
};

/**
 * GET — cooldown status per user, as a map of userid -> {active, reason,
 * entered_at}. Feeds the Cooldown column on /admin/users (same shape/pattern
 * as the match/message/image count endpoints).
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data, error } = await supabaseAdmin
    .from('user_cooldown')
    .select('user_id, active, reason, entered_at');
  if (error) return jsonError(error.message, 500);

  const map: Record<string, CooldownStatus> = {};
  for (const r of data ?? []) {
    map[r.user_id] = { active: r.active, reason: r.reason, entered_at: r.entered_at };
  }
  return NextResponse.json({ data: map });
}
