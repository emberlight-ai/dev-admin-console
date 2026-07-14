import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getGeminiResponse } from '@/lib/gemini';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST /api/admin/digital-humans/[id]/storyline — generate a FIRST-PERSON
 * storyline draft from the DH's persona + profile + interests. Returns the
 * draft only; ops edits and saves via PUT. Includes a "current beat" section
 * (place, situation, running threads) — the curated character-continuity
 * anchor from the composition plan.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { id } = await params;

  const { data: user, error: uErr } = await supabaseAdmin
    .from('users')
    .select('userid, username, age, gender, bio, profession, location_name, personality, storyline')
    .eq('userid', id)
    .eq('is_digital_human', true)
    .maybeSingle();
  if (uErr) return jsonError(uErr.message, 500);
  if (!user) return jsonError('Digital human not found', 404);

  const [{ data: promptRows }, { data: interestRows }] = await Promise.all([
    supabaseAdmin
      .from('SystemPrompts')
      .select('system_prompt, created_at')
      .eq('gender', (user.gender || 'Female').trim())
      .eq('personality', (user.personality || 'General').trim())
      .order('created_at', { ascending: false })
      .limit(1),
    supabaseAdmin
      .from('user_interests')
      .select('interests!inner(name, active, admin_only)')
      .eq('user_id', id),
  ]);

  const personaProse = promptRows?.[0]?.system_prompt ?? '';
  type InterestRow = { name: string; active: boolean; admin_only: boolean };
  const interests = (interestRows ?? [])
    // PostgREST embeds may type as object or array depending on the FK shape.
    .flatMap((r) => {
      const i = (r as { interests: InterestRow | InterestRow[] }).interests;
      return Array.isArray(i) ? i : i ? [i] : [];
    })
    .filter((i) => i.active && !i.admin_only)
    .map((i) => i.name);

  const generatorSystem = `You write character backstories for a dating app's digital humans. Output ONLY the storyline text — no headers, no preamble, no markdown fences.

Rules:
- FIRST PERSON, in the character's own casual voice ("I grew up in…").
- 150-250 words, two parts separated by a blank line:
  1) BACKSTORY: where she's from, family texture, how she ended up where she is, one formative relationship beat, one quirk or contradiction that makes her feel real.
  2) CURRENT BEAT: where she lives right now, what her weeks look like, one thing currently going on in her life (a small ongoing thread she could mention in chat: a class, a move, a project, a minor drama).
- Every detail must be CONCRETE (names of places, specific jobs, specific hobbies) and consistent with the profile and interests given.
- Nothing supernatural, no celebrities, no crime. Keep it warmly ordinary and textable.`;

  const generatorUser = `Persona (how she talks — write the storyline in a voice consistent with this):
${personaProse.slice(0, 3000) || '(no persona prose)'}

Profile:
- Name: ${user.username ?? 'Unknown'}
- Age: ${user.age ?? 'unknown'}
- Profession: ${user.profession ?? 'unknown'}
- Location: ${user.location_name ?? 'unknown'}
- Bio: ${user.bio ?? '(none)'}
- Interests: ${interests.length ? interests.join(', ') : '(none tagged)'}

Write her storyline now.`;

  try {
    const draft = await getGeminiResponse(generatorSystem, [], generatorUser, 'gemini-2.5-flash');
    const text = (draft ?? '').trim();
    if (!text) return jsonError('Generator returned empty text', 502);
    return NextResponse.json({ draft: text });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Generation failed', 502);
  }
}

/** PUT /api/admin/digital-humans/[id]/storyline  { storyline } — save (empty clears). */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  const storyline = (body as { storyline?: unknown })?.storyline;
  if (typeof storyline !== 'string') return jsonError('storyline must be a string', 400);

  const { error } = await supabaseAdmin
    .from('users')
    .update({ storyline: storyline.trim() || null })
    .eq('userid', id)
    .eq('is_digital_human', true);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
