import { NextRequest, NextResponse } from 'next/server';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import { supabaseAdmin } from '@/lib/supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

const BOOST_DURATION_MS = 15 * 60 * 1000;

type BoostRow = { id: string; started_at: string; expires_at: string };

async function activeBoost(userId: string): Promise<BoostRow | null> {
  const { data } = await supabaseAdmin
    .from('user_boost')
    .select('id, started_at, expires_at')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as BoostRow | null) ?? null;
}

async function totalBoosts(userId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('user_boost')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return count ?? 0;
}

/**
 * POST — activate a boost (ledger model: one immutable row per activation,
 * expires_at = started_at + 15 min; "active" is derived, never mutated).
 *
 * Monetization rule: the FIRST boost ever is free; every later boost requires
 * an active subscription. Returns 403 {error: "premium_required"} otherwise —
 * the app routes that to the paywall.
 */
async function handlePOST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonError(userErr?.message || 'Unauthorized', 401);
    }
    const userId = userData.user.id;

    // Idempotent while a boost is running.
    const running = await activeBoost(userId);
    const priorCount = await totalBoosts(userId);
    if (running) {
      return NextResponse.json({
        success: true,
        boost: running,
        already_active: true,
        total_boosts: priorCount,
      });
    }

    if (priorCount >= 1) {
      // Not the free first boost — require an active subscription. The user's
      // own client + RLS scopes this to their rows (same source of truth as
      // the entitlement route).
      const { data: subs } = await supabase
        .from('subscription')
        .select('status, current_period_end')
        .eq('status', 'ACTIVE');
      const now = Date.now();
      const isPremium = (subs ?? []).some(
        (s) => !s.current_period_end || new Date(s.current_period_end).getTime() > now
      );
      if (!isPremium) return jsonError('premium_required', 403);
    }

    const startedAt = new Date();
    const { data: boost, error: insErr } = await supabaseAdmin
      .from('user_boost')
      .insert({
        user_id: userId,
        started_at: startedAt.toISOString(),
        expires_at: new Date(startedAt.getTime() + BOOST_DURATION_MS).toISOString(),
      })
      .select('id, started_at, expires_at')
      .single();

    if (insErr) return jsonError(insErr.message, 500);

    return NextResponse.json({
      success: true,
      boost,
      already_active: false,
      total_boosts: priorCount + 1,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

/** Current boost state + lifetime count — drives free-first-boost vs paywall in the app. */
async function handleGET(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonError(userErr?.message || 'Unauthorized', 401);
    }
    const userId = userData.user.id;

    const [running, count] = await Promise.all([activeBoost(userId), totalBoosts(userId)]);
    return NextResponse.json({ success: true, active_boost: running, total_boosts: count });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const POST = withLogging(handlePOST);
export const GET = withLogging(handleGET);
