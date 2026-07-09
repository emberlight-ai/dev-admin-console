import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type Params = { params: Promise<{ userid: string }> };

/** GET — this user's cooldown row (null if they've never been in cooldown). */
export async function GET(req: NextRequest, { params }: Params) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  const { data, error } = await supabaseAdmin
    .from('user_cooldown')
    .select('user_id, active, reason, message_count_at_entry, entered_at, exited_at')
    .eq('user_id', userid)
    .maybeSingle();
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ data: data ?? null });
}

/**
 * POST {active: boolean} — manually enter/exit cooldown. Entry keeps the two
 * busiest DH conversations replying and mutes the rest; exit unmutes everything.
 * Both go through rpc_set_user_cooldown — the same path the reply engine's
 * auto-entry uses, so admin and automatic cooldowns can't drift.
 */
export async function POST(req: NextRequest, { params }: Params) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  let active: boolean;
  try {
    const body = await req.json();
    if (typeof body?.active !== 'boolean') return jsonError('active (boolean) is required', 400);
    active = body.active;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { data, error } = await supabaseAdmin.rpc('rpc_set_user_cooldown', {
    p_user_id: userid,
    p_active: active,
    p_reason: 'manual',
  });
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ data });
}
