import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { FRESH_PROFILE_FIELDS, purgeUserContent } from '@/lib/account-reset';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

const getUserSupabase = (req: NextRequest) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: authHeader } },
    }
  );
};

function sha256Hex(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function fetchAllRows<T>(
  queryFactory: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>
) {
  const pageSize = 1000;
  const maxRows = 200_000; // safety cap
  const out: T[] = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const from = offset;
    const to = offset + pageSize - 1;
    const { data, error } = await queryFactory(from, to);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out;
}

async function handlePOST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);

    // 1) Validate the caller and get their user id from the provided JWT.
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return NextResponse.json(
        { error: userErr?.message || 'Unauthorized' },
        { status: 401 }
      );
    }
    const userId = userData.user.id;

    // 2) Snapshot minimal usage data BEFORE we delete the Auth user (cascades will wipe profile + related rows).
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select(
        'userid, username, age, gender, personality, zipcode, phone, bio, education, profession, avatar, location_name, longitude, latitude, notification_enabled, location_enabled, created_at, updated_at, deleted_at, is_digital_human'
      )
      .eq('userid', userId)
      .maybeSingle();

    const [
      postsCount,
      messagesCount,
      matchesCount,
      matchRequestsCount,
      blocksCount,
      reportsCount,
      pushTokensCount,
      invitesTracking,
    ] = await Promise.all([
      supabaseAdmin
        .from('user_posts')
        .select('id', { count: 'exact', head: true })
        .eq('userid', userId),
      supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`),
      supabaseAdmin
        .from('user_matches')
        .select('id', { count: 'exact', head: true })
        .or(`user_a.eq.${userId},user_b.eq.${userId}`),
      supabaseAdmin
        .from('match_requests')
        .select('id', { count: 'exact', head: true })
        .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`),
      supabaseAdmin
        .from('blocks')
        .select('id', { count: 'exact', head: true })
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
      supabaseAdmin
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .or(`reporter_id.eq.${userId},target_user_id.eq.${userId}`),
      supabaseAdmin
        .from('user_push_tokens')
        .select('token', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabaseAdmin
        .from('digital_human_invites_tracking')
        .select('invite_count, updated_at')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    const { data: adminUserData, error: adminUserErr } =
      await supabaseAdmin.auth.admin.getUserById(userId);
    if (adminUserErr)
      return NextResponse.json(
        { error: adminUserErr.message },
        { status: 500 }
      );

    const identities = adminUserData.user?.identities ?? [];
    const appleIdentity = identities.find((i) => i.provider === 'apple');

    const salt = process.env.DELETION_HASH_SALT || '';
    const providerSubject = (
      appleIdentity?.identity_data as Record<string, unknown> | undefined
    )?.sub;
    const providerSubjectHash =
      salt && typeof providerSubject === 'string'
        ? sha256Hex(`${salt}:${providerSubject}`)
        : null;
    const emailHash =
      salt && typeof adminUserData.user?.email === 'string'
        ? sha256Hex(`${salt}:${adminUserData.user.email.toLowerCase()}`)
        : null;

    const usageSnapshot = {
      user_posts: postsCount.count ?? 0,
      messages: messagesCount.count ?? 0,
      user_matches: matchesCount.count ?? 0,
      match_requests: matchRequestsCount.count ?? 0,
      blocks: blocksCount.count ?? 0,
      reports: reportsCount.count ?? 0,
      user_push_tokens: pushTokensCount.count ?? 0,
      digital_human_invites_tracking: invitesTracking.data ?? null,
    };

    // 2b) Archive full details needed for admin review (posts, matches, messages).
    // These are hard-deleted by purgeUserContent below; the snapshot is the only
    // copy that survives.
    const postsSnapshot = await fetchAllRows<Record<string, unknown>>(
      (from, to) =>
        supabaseAdmin
          .from('user_posts')
          .select('*')
          .eq('userid', userId)
          .order('created_at', { ascending: true })
          .range(from, to)
    );

    const matchesSnapshot = await fetchAllRows<Record<string, unknown>>(
      (from, to) =>
        supabaseAdmin
          .from('user_matches')
          .select('*')
          .or(`user_a.eq.${userId},user_b.eq.${userId}`)
          .order('created_at', { ascending: true })
          .range(from, to)
    );

    const matchIds = matchesSnapshot
      .map((m) => m.id)
      .filter((v): v is string => typeof v === 'string');

    const messagesSnapshot =
      matchIds.length === 0
        ? []
        : await fetchAllRows<Record<string, unknown>>((from, to) =>
            supabaseAdmin
              .from('messages')
              .select('*')
              .in('match_id', matchIds)
              .order('created_at', { ascending: true })
              .range(from, to)
          );

    const { error: auditErr } = await supabaseAdmin
      .from('user_deletion_audit')
      .insert({
        deleted_user_id: userId,
        deleted_at: new Date().toISOString(),
        provider: appleIdentity?.provider ?? null,
        provider_subject_hash: providerSubjectHash,
        email_hash: emailHash,
        profile_snapshot: profile ?? null,
        usage_snapshot: usageSnapshot,
        posts_snapshot: postsSnapshot,
        matches_snapshot: matchesSnapshot,
        messages_snapshot: messagesSnapshot,
      });

    // Safety: never delete the Auth user unless the audit write succeeded.
    if (auditErr) {
      return NextResponse.json({ error: auditErr.message }, { status: 500 });
    }

    // 3) SOFT-DELETE + WIPE. Account deletion is NOT a refund, so we must keep
    //    the user row and (crucially) their `subscription` rows for billing/ops
    //    visibility in the admin console. We therefore do NOT hard-delete the
    //    Supabase Auth user — that cascades `public.users` (FK ON DELETE CASCADE)
    //    and wipes the subscription. Instead we set `deleted_at` AND reset every
    //    profile field to its bootstrap default: the audit snapshot above is the
    //    only copy of their data we retain (GDPR), and a returning sign-in with
    //    the same provider goes through clean onboarding on a blank account
    //    instead of resurrecting the old one (see the iOS profile GET/PATCH
    //    fresh-start restore, which only clears `deleted_at`).
    const nowIso = new Date().toISOString();
    const { error: softErr } = await supabaseAdmin
      .from('users')
      .update({ ...FRESH_PROFILE_FIELDS, deleted_at: nowIso })
      .eq('userid', userId);
    if (softErr) {
      return NextResponse.json({ error: softErr.message }, { status: 500 });
    }

    // Remove posts, matches (cascades messages + AI state + DH match memory),
    // swipes, pending invites, push tokens and safety rows — everything was
    // snapshotted into user_deletion_audit above, so analytics/admin review
    // still have the data while the live tables are clean for a fresh start.
    await purgeUserContent(userId);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

export const POST = withLogging(handlePOST);
