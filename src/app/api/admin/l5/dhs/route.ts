import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// GET — L5 roster: every live digital human with engine, persona presence and
// latest debrief day, so the lab page can list + filter them.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data: dhs, error } = await supabaseAdmin
    .from('users')
    .select('userid, username, age, gender, personality, profession, avatar, whitelisted, dh_engine')
    .eq('is_digital_human', true)
    .is('deleted_at', null)
    .order('username');
  if (error) return jsonError(error.message, 500);

  const ids = (dhs ?? []).map((d) => d.userid);
  const personaSet = new Set<string>();
  const lastDebrief = new Map<string, string>();
  if (ids.length > 0) {
    const [{ data: personas }, { data: debriefs }] = await Promise.all([
      supabaseAdmin.from('dh_persona').select('dh_user_id').in('dh_user_id', ids),
      supabaseAdmin
        .from('dh_debrief')
        .select('dh_user_id, day')
        .in('dh_user_id', ids)
        .order('day', { ascending: false }),
    ]);
    for (const p of personas ?? []) personaSet.add(p.dh_user_id);
    for (const d of debriefs ?? []) {
      if (!lastDebrief.has(d.dh_user_id)) lastDebrief.set(d.dh_user_id, d.day);
    }
  }

  return NextResponse.json({
    dhs: (dhs ?? []).map((d) => ({
      ...d,
      has_persona: personaSet.has(d.userid),
      last_debrief_day: lastDebrief.get(d.userid) ?? null,
    })),
  });
}
