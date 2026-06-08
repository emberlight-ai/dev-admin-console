import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// GET — all whitelisted digital humans (featured at the top of the match deck),
// with their chat-image count and match count.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data: dhs, error } = await supabaseAdmin
    .from('users')
    .select('userid,username,avatar,gender,personality,created_at,updated_at')
    .eq('is_digital_human', true)
    .eq('whitelisted', true)
    .is('deleted_at', null)
    .order('username', { ascending: true });
  if (error) return jsonError(error.message, 500);

  const rows = (dhs ?? []) as Array<{ userid: string }>;
  const ids = rows.map((r) => r.userid);
  const idSet = new Set(ids);

  const imgCounts: Record<string, number> = {};
  const matchCounts: Record<string, number> = {};

  if (ids.length) {
    const { data: imgs } = await supabaseAdmin
      .from('dh_chat_images')
      .select('dh_user_id')
      .in('dh_user_id', ids)
      .eq('active', true);
    for (const i of imgs ?? []) {
      const id = (i as { dh_user_id: string }).dh_user_id;
      imgCounts[id] = (imgCounts[id] ?? 0) + 1;
    }

    // user_matches is small; count participations in JS rather than a giant .or().
    const { data: matches } = await supabaseAdmin
      .from('user_matches')
      .select('user_a,user_b');
    for (const m of matches ?? []) {
      const a = (m as { user_a: string }).user_a;
      const b = (m as { user_b: string }).user_b;
      if (idSet.has(a)) matchCounts[a] = (matchCounts[a] ?? 0) + 1;
      if (idSet.has(b)) matchCounts[b] = (matchCounts[b] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      chatImagesCount: imgCounts[r.userid] ?? 0,
      matchCount: matchCounts[r.userid] ?? 0,
    })),
  });
}
