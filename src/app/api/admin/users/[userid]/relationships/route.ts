import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type UserLite = {
  userid: string;
  username: string;
  avatar: string | null;
  is_digital_human: boolean;
};

type LeftSwipe = {
  swipe_id: string;
  created_at: string | null;
  target: UserLite | null;
};

type RightSwipe = {
  swipe_id: string;
  created_at: string | null;
  target: UserLite | null;
  status: 'pending' | 'matched' | 'declined';
  match_request_id: string | null;
  match_id: string | null;
};

type MatchEntry = {
  match_id: string;
  created_at: string | null;
  partner: UserLite | null;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;
  if (!userid) return jsonError('Missing userid', 400);

  // Pull this user's swipes, outbound pending requests, and matches in parallel.
  // The swipe table is the source of truth for like/dislike. Whether a right
  // swipe became a match, is still pending, or got declined is derived by
  // cross-referencing user_matches and match_requests.
  const [
    { data: swipesData, error: swipesErr },
    { data: outboundRequests, error: requestsErr },
    { data: matchesData, error: matchesErr },
  ] = await Promise.all([
    supabaseAdmin
      .from('swipe')
      .select('id,target_user_id,reaction,created_at')
      .eq('swiper_user_id', userid)
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('match_requests')
      .select('id,to_user_id,created_at')
      .eq('from_user_id', userid),
    supabaseAdmin
      .from('user_matches')
      .select('id,user_a,user_b,created_at')
      .or(`user_a.eq.${userid},user_b.eq.${userid}`)
      .order('created_at', { ascending: false }),
  ]);

  if (swipesErr) return jsonError(swipesErr.message, 500);
  if (requestsErr) return jsonError(requestsErr.message, 500);
  if (matchesErr) return jsonError(matchesErr.message, 500);

  // Resolve every counterparty in a single batched users query.
  const involvedIds = new Set<string>();
  for (const s of swipesData ?? []) involvedIds.add(s.target_user_id);
  for (const r of outboundRequests ?? []) involvedIds.add(r.to_user_id);
  for (const m of matchesData ?? []) {
    involvedIds.add(m.user_a === userid ? m.user_b : m.user_a);
  }

  let usersMap = new Map<string, UserLite>();
  if (involvedIds.size > 0) {
    const { data: usersData, error: usersErr } = await supabaseAdmin
      .from('users')
      .select('userid,username,avatar,is_digital_human')
      .in('userid', Array.from(involvedIds));
    if (usersErr) return jsonError(usersErr.message, 500);
    usersMap = new Map(
      (usersData ?? []).map((u) => [
        u.userid,
        {
          userid: u.userid,
          username: u.username,
          avatar: u.avatar ?? null,
          is_digital_human: Boolean(u.is_digital_human),
        },
      ])
    );
  }

  // Build status lookups for right-swipe row enrichment.
  const outboundRequestMap = new Map<string, { id: string; created_at: string | null }>();
  for (const r of outboundRequests ?? []) {
    outboundRequestMap.set(r.to_user_id, { id: r.id, created_at: r.created_at ?? null });
  }

  const matchByPartner = new Map<string, { id: string; created_at: string | null }>();
  for (const m of matchesData ?? []) {
    const partnerId = m.user_a === userid ? m.user_b : m.user_a;
    matchByPartner.set(partnerId, { id: m.id, created_at: m.created_at ?? null });
  }

  const left_swipes: LeftSwipe[] = [];
  const right_swipes: RightSwipe[] = [];

  for (const s of swipesData ?? []) {
    const target = usersMap.get(s.target_user_id) ?? null;
    if (s.reaction === 'dislike') {
      left_swipes.push({ swipe_id: s.id, created_at: s.created_at ?? null, target });
      continue;
    }
    if (s.reaction === 'like') {
      const matched = matchByPartner.get(s.target_user_id);
      const pendingReq = outboundRequestMap.get(s.target_user_id);
      const status: RightSwipe['status'] = matched
        ? 'matched'
        : pendingReq
          ? 'pending'
          : 'declined';

      right_swipes.push({
        swipe_id: s.id,
        created_at: s.created_at ?? null,
        target,
        status,
        match_request_id: pendingReq?.id ?? null,
        match_id: matched?.id ?? null,
      });
    }
  }

  const matches: MatchEntry[] = (matchesData ?? []).map((m) => {
    const partnerId = m.user_a === userid ? m.user_b : m.user_a;
    return {
      match_id: m.id,
      created_at: m.created_at ?? null,
      partner: usersMap.get(partnerId) ?? null,
    };
  });

  return NextResponse.json({ left_swipes, right_swipes, matches });
}
