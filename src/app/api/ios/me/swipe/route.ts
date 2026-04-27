import { NextRequest, NextResponse } from 'next/server';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

type Body = {
  target_user_id?: unknown;
  reaction?: unknown;
};

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

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const POST = withLogging(handlePOST);
