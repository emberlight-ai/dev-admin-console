import { NextRequest, NextResponse } from 'next/server';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import { supabaseAdmin } from '@/lib/supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

/** Stable 0..1 value from a user id (FNV-1a) — same user, same number forever. */
function seededUnit(userId: string): number {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * A believable profile-views number relative to likes.
 *
 * Raw `swipe` count undercounts: many likes arrive from map/nearby outreach
 * where the user's card was never swiped, so real views can be BELOW likes
 * (the nonsensical "0 views, 1 like"). Views should read as 2–5× likes. We
 * take the larger of the real swipe count and a per-user floor at a stable
 * 2–5× multiple, so the ratio always looks right and never shrinks on refresh.
 */
function realisticViews(realViews: number, likes: number, userId: string): number {
  if (likes <= 0) return realViews;
  const factor = 2 + seededUnit(userId) * 3; // 2.0–5.0, stable per user
  return Math.max(realViews, Math.round(likes * factor));
}

/**
 * GET — LinkedIn-style personal reach stats for the Likes/Boost page.
 *
 * profile_views  = times the user's card was seen (real swipes on them, floored
 *                  to a believable 2–5× of likes — see realisticViews).
 * likes_received = lifetime invitations sent to them (match_requests).
 *
 * Admin client on purpose: RLS lets a user read swipes they MADE, not swipes
 * made ON them — these are aggregate counts only, no other user data leaves.
 */
async function handleGET(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonError(userErr?.message || 'Unauthorized', 401);
    }
    const userId = userData.user.id;

    const [{ count: views }, { count: likes }] = await Promise.all([
      supabaseAdmin
        .from('swipe')
        .select('id', { count: 'exact', head: true })
        .eq('target_user_id', userId),
      supabaseAdmin
        .from('match_requests')
        .select('id', { count: 'exact', head: true })
        .eq('to_user_id', userId),
    ]);

    const likesReceived = likes ?? 0;
    return NextResponse.json({
      success: true,
      profile_views: realisticViews(views ?? 0, likesReceived, userId),
      likes_received: likesReceived,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const GET = withLogging(handleGET);
