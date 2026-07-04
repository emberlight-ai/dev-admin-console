import { NextRequest, NextResponse } from 'next/server';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import { supabaseAdmin } from '@/lib/supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

/**
 * GET — LinkedIn-style personal reach stats for the Likes/Boost page.
 *
 * profile_views  = how many times this user's card was swiped on (their card
 *                  was SEEN and acted on — the closest real signal we record).
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

    return NextResponse.json({
      success: true,
      profile_views: views ?? 0,
      likes_received: likes ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const GET = withLogging(handleGET);
