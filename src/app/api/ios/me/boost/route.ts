import { NextRequest, NextResponse } from 'next/server';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import { supabaseAdmin } from '@/lib/supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

/**
 * Profile boost ("activateBoost"). Records who boosted and when in user_boost;
 * the actual ranking placement + expiry job come later. Idempotent: activating
 * while a boost is already active returns the existing boost instead of
 * stacking rows.
 */
async function handlePOST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonError(userErr?.message || 'Unauthorized', 401);
    }
    const userId = userData.user.id;

    const { data: existing } = await supabaseAdmin
      .from('user_boost')
      .select('id, started_at, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: true, boost: existing, already_active: true });
    }

    const { data: boost, error: insErr } = await supabaseAdmin
      .from('user_boost')
      .insert({ user_id: userId, started_at: new Date().toISOString(), status: 'active' })
      .select('id, started_at, status')
      .single();

    if (insErr) return jsonError(insErr.message, 500);

    return NextResponse.json({ success: true, boost, already_active: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

/** Current boost state — lets the app show "Boost active" instead of the button. */
async function handleGET(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonError(userErr?.message || 'Unauthorized', 401);
    }

    const { data: boost } = await supabaseAdmin
      .from('user_boost')
      .select('id, started_at, status')
      .eq('user_id', userData.user.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({ success: true, boost: boost ?? null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const POST = withLogging(handlePOST);
export const GET = withLogging(handleGET);
