import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET /api/admin/strategies/board
 * → { dhs: [{userid, username, gender, personality, strategy_key, updated_at}],
 *     personaDefaults: { "gender:personality": strategy_key } }
 *
 * Everything the effort kanban needs in one payload: DHs with an explicit
 * strategy sit in that tier's column; strategy_key = null means "auto" (the
 * persona's default, resolved client-side via personaDefaults).
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const [{ data: dhs, error: dhErr }, { data: prompts, error: pErr }] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('userid, username, gender, personality, strategy_key, updated_at')
      .eq('is_digital_human', true)
      .is('deleted_at', null)
      .order('username'),
    supabaseAdmin
      .from('SystemPrompts')
      .select('gender, personality, default_strategy_key, created_at')
      .order('created_at', { ascending: false }),
  ]);
  if (dhErr) return jsonError(dhErr.message, 500);
  if (pErr) return jsonError(pErr.message, 500);

  // Newest row per gender:personality wins (SystemPrompts is version history).
  const personaDefaults: Record<string, string | null> = {};
  for (const p of prompts ?? []) {
    const k = `${(p.gender || '').trim()}:${(p.personality || '').trim()}`;
    if (!(k in personaDefaults)) personaDefaults[k] = p.default_strategy_key ?? null;
  }

  return NextResponse.json({ dhs: dhs ?? [], personaDefaults });
}

/**
 * POST /api/admin/strategies/board  { user_id, strategy_key | null }
 * Drag-drop assignment: null returns the DH to "auto" (persona default).
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  const { user_id: userId, strategy_key: strategyKey } = body as {
    user_id?: unknown;
    strategy_key?: unknown;
  };
  if (typeof userId !== 'string' || !userId) return jsonError('user_id is required', 400);
  if (strategyKey !== null && typeof strategyKey !== 'string') {
    return jsonError('strategy_key must be a string or null', 400);
  }

  if (typeof strategyKey === 'string') {
    const { data: strat } = await supabaseAdmin
      .from('strategies')
      .select('key')
      .eq('key', strategyKey)
      .maybeSingle();
    if (!strat) return jsonError('Unknown strategy', 400);
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({ strategy_key: strategyKey })
    .eq('userid', userId)
    .eq('is_digital_human', true);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
