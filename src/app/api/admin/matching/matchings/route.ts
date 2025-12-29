import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') ?? 'stats').trim(); // stats | chart | list

  if (mode === 'stats') {
    // Get time range from query params or default to 1 hour
    const preset = url.searchParams.get('preset') ?? '1h';
    const now = new Date();
    let timeAgo: Date;
    switch (preset) {
      case '15m':
        timeAgo = new Date(now.getTime() - 15 * 60 * 1000);
        break;
      case '1h':
        timeAgo = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '1d':
        timeAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      default:
        timeAgo = new Date(now.getTime() - 60 * 60 * 1000);
    }

    // Fetch invites with user details to determine relationship types
    const { data: invitesData, error: invitesError } = await supabaseAdmin
      .from('match_requests')
      .select('from_user_id,to_user_id')
      .gte('created_at', timeAgo.toISOString());

    // Fetch user details for all invite participants
    const userIds = new Set<string>();
    if (invitesData) {
      for (const invite of invitesData) {
        userIds.add(invite.from_user_id);
        userIds.add(invite.to_user_id);
      }
    }

    const { data: usersData, error: usersError } = await supabaseAdmin
      .from('users')
      .select('userid,is_digital_human')
      .in('userid', Array.from(userIds))
      .is('deleted_at', null);

    if (invitesError || usersError) {
      return jsonError('Error fetching stats', 500);
    }

    // Create user lookup map
    const usersMap = new Map((usersData ?? []).map((u) => [u.userid, u.is_digital_human]));

    // Count relationship types
    let userToUser = 0;
    let userToDH = 0;
    let dhToUser = 0;

    if (invitesData) {
      for (const invite of invitesData) {
        const fromIsDH = usersMap.get(invite.from_user_id) ?? false;
        const toIsDH = usersMap.get(invite.to_user_id) ?? false;

        if (!fromIsDH && !toIsDH) {
          userToUser++;
        } else if (!fromIsDH && toIsDH) {
          userToDH++;
        } else if (fromIsDH && !toIsDH) {
          dhToUser++;
        }
      }
    }

    // Fetch matches with user details to determine relationship types
    const { data: matchesData, error: matchesError } = await supabaseAdmin
      .from('user_matches')
      .select('user_a,user_b')
      .gte('created_at', timeAgo.toISOString());

    if (matchesError) {
      return jsonError('Error fetching matches', 500);
    }

    // Collect all match user IDs
    const matchUserIds = new Set<string>();
    if (matchesData) {
      for (const match of matchesData) {
        matchUserIds.add(match.user_a);
        matchUserIds.add(match.user_b);
      }
    }

    // Fetch user details for all match participants (merge with existing userIds if needed)
    const allUserIds = new Set([...userIds, ...matchUserIds]);
    const { data: allUsersData, error: allUsersError } = await supabaseAdmin
      .from('users')
      .select('userid,is_digital_human')
      .in('userid', Array.from(allUserIds))
      .is('deleted_at', null);

    if (allUsersError) {
      return jsonError('Error fetching user data for matches', 500);
    }

    // Create comprehensive user lookup map
    const allUsersMap = new Map((allUsersData ?? []).map((u) => [u.userid, u.is_digital_human]));

    // Count match relationship types
    let matchUserToUser = 0; // Both are real users
    let matchDHMatch = 0; // At least one is a digital human

    if (matchesData) {
      for (const match of matchesData) {
        const userAIsDH = allUsersMap.get(match.user_a) ?? false;
        const userBIsDH = allUsersMap.get(match.user_b) ?? false;

        if (!userAIsDH && !userBIsDH) {
          matchUserToUser++;
        } else {
          // At least one is a digital human
          matchDHMatch++;
        }
      }
    }

    return NextResponse.json({
      invites: {
        userToUser: userToUser,
        userToDH: userToDH,
        dhToUser: dhToUser,
      },
      matches: {
        userToUser: matchUserToUser,
        dhMatch: matchDHMatch,
      },
    });
  }

  if (mode === 'chart') {
    const createdFrom = url.searchParams.get('created_from');
    const createdTo = url.searchParams.get('created_to');
    if (!createdFrom || !createdTo) {
      return jsonError('Missing required query params: created_from, created_to', 400);
    }

    const [{ data: invitesData, error: invitesError }, { data: matchesData, error: matchesError }] =
      await Promise.all([
        supabaseAdmin
          .from('match_requests')
          .select('created_at')
          .gte('created_at', createdFrom)
          .lte('created_at', createdTo)
          .order('created_at', { ascending: true }),
        supabaseAdmin
          .from('user_matches')
          .select('created_at')
          .gte('created_at', createdFrom)
          .lte('created_at', createdTo)
          .order('created_at', { ascending: true }),
      ]);

    if (invitesError || matchesError) {
      return jsonError('Error fetching chart data', 500);
    }

    return NextResponse.json({
      invites: invitesData ?? [],
      matches: matchesData ?? [],
    });
  }

  // mode=list - Get recent invites and matches with user details
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);

  // Fetch invites and matches first
  const [{ data: invitesData, error: invitesError }, { data: matchesData, error: matchesError }] =
    await Promise.all([
      supabaseAdmin
        .from('match_requests')
        .select('id,from_user_id,to_user_id,created_at')
        .order('created_at', { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from('user_matches')
        .select('id,user_a,user_b,created_at')
        .order('created_at', { ascending: false })
        .limit(limit),
    ]);

  if (invitesError || matchesError) {
    return jsonError('Error fetching list data', 500);
  }

  // Collect all user IDs
  const userIds = new Set<string>();
  for (const invite of invitesData ?? []) {
    userIds.add(invite.from_user_id);
    userIds.add(invite.to_user_id);
  }
  for (const match of matchesData ?? []) {
    userIds.add(match.user_a);
    userIds.add(match.user_b);
  }

  // Fetch user details
  const { data: usersData, error: usersError } = await supabaseAdmin
    .from('users')
    .select('userid,username,avatar,is_digital_human')
    .in('userid', Array.from(userIds))
    .is('deleted_at', null);

  if (usersError) {
    return jsonError('Error fetching user data', 500);
  }

  // Create user lookup map
  const usersMap = new Map(
    (usersData ?? []).map((u) => [u.userid, { ...u, avatar: u.avatar || null }])
  );

  // Enrich invites with user data
  const enrichedInvites = (invitesData ?? []).map((invite) => ({
    ...invite,
    from_user: usersMap.get(invite.from_user_id) || null,
    to_user: usersMap.get(invite.to_user_id) || null,
  }));

  // Enrich matches with user data
  const enrichedMatches = (matchesData ?? []).map((match) => ({
    ...match,
    user_a_data: usersMap.get(match.user_a) || null,
    user_b_data: usersMap.get(match.user_b) || null,
  }));

  return NextResponse.json({
    invites: enrichedInvites,
    matches: enrichedMatches,
  });
}

