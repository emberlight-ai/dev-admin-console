import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

// Green mode = an on/off switch + the user_interests('green_mode') tag pool
// (curated on /admin/categories, same as Whitelist). This route only manages
// the switch; membership goes through the interests member APIs.
const GREEN_MODE_ENABLED_KEY = 'green_mode_enabled';
const GREEN_MODE_INTEREST_KEY = 'green_mode';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** GET → { data: { enabled, memberCount } } */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const [configRes, membersRes] = await Promise.all([
    supabaseAdmin
      .from('digital_human_config')
      .select('value')
      .eq('key', GREEN_MODE_ENABLED_KEY)
      .maybeSingle(),
    supabaseAdmin
      .from('user_interests')
      .select('user_id', { count: 'exact', head: true })
      .eq('interest_key', GREEN_MODE_INTEREST_KEY),
  ]);
  if (configRes.error) return jsonError(configRes.error.message, 500);
  if (membersRes.error) return jsonError(membersRes.error.message, 500);

  const enabled = (configRes.data?.value ?? '').trim().toLowerCase() === 'true';
  return NextResponse.json({ data: { enabled, memberCount: membersRes.count ?? 0 } });
}

/** POST { enabled: boolean } → { success, data: { enabled } } */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const enabled = (body as { enabled?: unknown })?.enabled;
  if (typeof enabled !== 'boolean') return jsonError('enabled must be a boolean', 400);

  const { error } = await supabaseAdmin.from('digital_human_config').upsert(
    {
      key: GREEN_MODE_ENABLED_KEY,
      value: enabled ? 'true' : 'false',
      description:
        'When true, matching surfaces (deck, invitations, boosts) only serve digital humans tagged Green Mode.',
    },
    { onConflict: 'key' }
  );
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ success: true, data: { enabled } });
}
