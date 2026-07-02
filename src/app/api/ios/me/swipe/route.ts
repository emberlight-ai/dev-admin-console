import { NextRequest, NextResponse } from 'next/server';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import { supabaseAdmin } from '@/lib/supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

type Body = {
  target_user_id?: unknown;
  reaction?: unknown;
};

/**
 * First-swipe hook: new users often don't open the map for a while, so the
 * map-triggered nearby invitations never fire and their first minutes are
 * silent. On the user's FIRST swipe ever, schedule one digital human to "like"
 * them ~50-60s later via scheduled_dh_invites — the dh-nearby-dispatch cron
 * (every minute) turns it into a match request + opener + push, which lands on
 * the Likes page right after the notifications prompt the app shows post-swipe.
 *
 * Best-effort by design: any failure here must never affect the swipe response.
 */
async function maybeScheduleFirstSwipeLike(userId: string, targetUserId: string) {
  try {
    // Only the FIRST swipe (the row we just inserted counts as 1).
    const { count: swipeCount } = await supabaseAdmin
      .from('swipe')
      .select('id', { count: 'exact', head: true })
      .eq('swiper_user_id', userId);
    if ((swipeCount ?? 0) !== 1) return;

    // Skip if outreach already reached this user some other way (map invites
    // already queued, or a pending invitation is sitting in their Likes).
    const [{ count: queued }, { count: pendingInvites }] = await Promise.all([
      supabaseAdmin
        .from('scheduled_dh_invites')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabaseAdmin
        .from('match_requests')
        .select('id', { count: 'exact', head: true })
        .eq('to_user_id', userId),
    ]);
    if ((queued ?? 0) > 0 || (pendingInvites ?? 0) > 0) return;

    // Match the vibe of what they just swiped on: same gender as the target.
    const { data: target } = await supabaseAdmin
      .from('users')
      .select('gender')
      .eq('userid', targetUserId)
      .maybeSingle();

    let dhQuery = supabaseAdmin
      .from('users')
      .select('userid')
      .eq('is_digital_human', true)
      .eq('whitelisted', true)
      .is('deleted_at', null)
      .not('avatar', 'is', null)
      .neq('userid', targetUserId)
      .limit(25);
    if (target?.gender) dhQuery = dhQuery.eq('gender', target.gender);
    const { data: candidates } = await dhQuery;
    if (!candidates || candidates.length === 0) return;

    const dh = candidates[Math.floor(Math.random() * candidates.length)];
    const delaySeconds = 50 + Math.floor(Math.random() * 10); // 50-60s
    const runAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

    const { error } = await supabaseAdmin.from('scheduled_dh_invites').insert({
      user_id: userId,
      dh_user_id: dh.userid,
      run_at: runAt,
      status: 'pending',
    });
    if (error) {
      console.warn('[swipe] first-swipe like scheduling failed', error.message);
    } else {
      console.info('[swipe] scheduled first-swipe like', {
        userId,
        dh: dh.userid,
        delaySeconds,
      });
    }
  } catch (err) {
    console.warn('[swipe] first-swipe like hook threw (non-fatal)', err);
  }
}

/**
 * POST — record a swipe event (see docs/subscription-design.md §2.B).
 */
async function handlePOST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonError(userErr?.message || 'Unauthorized', 401);
    }
    const swiperUserId = userData.user.id;

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return jsonError('Invalid JSON body', 400);
    }

    const targetUserId =
      typeof body.target_user_id === 'string' ? body.target_user_id.trim() : '';
    const reaction = typeof body.reaction === 'string' ? body.reaction.trim() : '';

    if (!targetUserId) return jsonError('target_user_id is required', 400);
    if (reaction !== 'like' && reaction !== 'dislike') {
      return jsonError('reaction must be "like" or "dislike"', 400);
    }
    if (targetUserId === swiperUserId) {
      return jsonError('Cannot swipe yourself', 400);
    }

    const { error: insErr } = await supabase.from('swipe').insert({
      swiper_user_id: swiperUserId,
      target_user_id: targetUserId,
      reaction,
    });

    if (insErr) return jsonError(insErr.message, 500);

    // Guaranteed early "liked you" for brand-new users (see helper above).
    await maybeScheduleFirstSwipeLike(swiperUserId, targetUserId);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const POST = withLogging(handlePOST);
