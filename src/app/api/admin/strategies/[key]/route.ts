import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const NUMERIC_FIELDS = [
  'check_ins_per_day',
  'reply_min_delay_seconds', 'reply_max_delay_seconds', 'reply_chars_per_second',
  'skip_reply_base_chance', 'skip_reply_intimacy_drop_chance',
  'skip_reply_intimacy_drop_delta', 'skip_reply_max_consecutive', 'sort_order',
] as const;
const BOOL_FIELDS = [
  'active_greeting_enabled', 'skip_reply_enabled', 'outbound_enabled',
] as const;
const WARMUP_RATES = ['very_low', 'low', 'normal', 'high', 'very_high', 'extreme'];

/** PATCH /api/admin/strategies/[key] — tune a preset's knobs. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { key } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  const b = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim();
  if (typeof b.description === 'string') patch.description = b.description.trim();
  for (const f of NUMERIC_FIELDS) {
    if (typeof b[f] === 'number' && Number.isFinite(b[f])) patch[f] = b[f];
  }
  for (const f of BOOL_FIELDS) {
    if (typeof b[f] === 'boolean') patch[f] = b[f];
  }
  if (typeof b.intimacy_warmup_rate === 'string' && WARMUP_RATES.includes(b.intimacy_warmup_rate)) {
    patch.intimacy_warmup_rate = b.intimacy_warmup_rate;
  }
  // Escalating follow-up gaps, seconds; [] = never chases. Max 10 rungs.
  if (Array.isArray(b.follow_up_ladder)) {
    const ladder = b.follow_up_ladder
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v >= 60 && v <= 30 * 86400)
      .map((v) => Math.round(v))
      .slice(0, 10);
    patch.follow_up_ladder = ladder;
  }

  if (Object.keys(patch).length === 0) return jsonError('Nothing to update', 400);
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('strategies')
    .update(patch)
    .eq('key', key)
    .select('*')
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError('Strategy not found', 404);
  return NextResponse.json({ data });
}
