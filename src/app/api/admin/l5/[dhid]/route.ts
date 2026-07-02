import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// GET — everything the L5 lab needs for one DH: profile, persona kernel,
// timeline (debriefs + diaries, newest first), image inventory, quick metrics.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dhid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { dhid } = await params;
  if (!dhid) return jsonError('Missing dhid', 400);

  const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [profileRes, personaRes, debriefsRes, diariesRes, imagesRes, sentRes, recvRes, statesRes] =
    await Promise.all([
      supabaseAdmin
        .from('users')
        .select('userid, username, age, gender, personality, profession, bio, avatar, storyline, whitelisted, dh_engine')
        .eq('userid', dhid)
        .maybeSingle(),
      supabaseAdmin
        .from('dh_persona')
        .select('tastes, texting_style, schedule, okr, notes, updated_at')
        .eq('dh_user_id', dhid)
        .maybeSingle(),
      supabaseAdmin
        .from('dh_debrief')
        .select('day, metrics, notes, prompt_addendum, created_at')
        .eq('dh_user_id', dhid)
        .order('day', { ascending: false })
        .limit(14),
      supabaseAdmin
        .from('dh_diary')
        .select('day, mood, events, talking_points, created_at')
        .eq('dh_user_id', dhid)
        .order('day', { ascending: false })
        .limit(14),
      supabaseAdmin
        .from('dh_chat_images')
        .select('id, public_url, ordinal, image_tier, caption, active')
        .eq('dh_user_id', dhid)
        .order('ordinal'),
      supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_id', dhid)
        .gte('created_at', sinceIso),
      supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', dhid)
        .gte('created_at', sinceIso),
      supabaseAdmin
        .from('user_match_ai_state')
        .select('intimacy_score, intimacy_m')
        .eq('dh_user_id', dhid),
    ]);

  if (profileRes.error) return jsonError(profileRes.error.message, 500);
  if (!profileRes.data) return jsonError('Digital human not found', 404);

  const states = statesRes.data ?? [];
  const metrics24h = {
    messages_sent: sentRes.count ?? 0,
    messages_received: recvRes.count ?? 0,
    total_matches: states.length,
    matches_warming: states.filter((s) => (s.intimacy_m ?? 0) > 0.5).length,
    avg_intimacy: states.length
      ? Math.round(states.reduce((a, s) => a + (s.intimacy_score ?? 0), 0) / states.length)
      : null,
  };

  return NextResponse.json({
    profile: profileRes.data,
    persona: personaRes.data ?? null,
    debriefs: debriefsRes.data ?? [],
    diaries: diariesRes.data ?? [],
    images: imagesRes.data ?? [],
    metrics24h,
  });
}

// PUT — save persona kernel sections and/or flip the engine ('v1' | 'l5').
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ dhid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { dhid } = await params;
  if (!dhid) return jsonError('Missing dhid', 400);

  try {
    const body = await req.json();

    if (body.engine !== undefined) {
      if (body.engine !== 'v1' && body.engine !== 'l5') return jsonError('engine must be v1 or l5', 400);
      const { error } = await supabaseAdmin
        .from('users')
        .update({ dh_engine: body.engine })
        .eq('userid', dhid)
        .eq('is_digital_human', true);
      if (error) return jsonError(error.message, 500);
    }

    if (body.persona !== undefined) {
      const p = body.persona ?? {};
      const row: Record<string, unknown> = { dh_user_id: dhid, updated_at: new Date().toISOString() };
      for (const key of ['tastes', 'texting_style', 'schedule', 'okr'] as const) {
        if (p[key] !== undefined) {
          if (typeof p[key] !== 'object' || p[key] === null || Array.isArray(p[key])) {
            return jsonError(`persona.${key} must be a JSON object`, 400);
          }
          row[key] = p[key];
        }
      }
      if (p.notes !== undefined) row.notes = p.notes === null ? null : String(p.notes);
      const { error } = await supabaseAdmin
        .from('dh_persona')
        .upsert(row, { onConflict: 'dh_user_id' });
      if (error) return jsonError(error.message, 500);
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
}
