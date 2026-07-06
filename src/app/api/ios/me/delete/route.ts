import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { archiveUserContent, FRESH_PROFILE_FIELDS, purgeUserContent } from '@/lib/account-reset';
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

    // 2b) PRESERVE everything before touching the live tables: full posts
    // (with photos), matches, and complete message transcripts get copied into
    // the archived_* tables and their storage objects moved to an archived/
    // folder (see account-reset.ts). This app is not GDPR-scoped and every
    // user represents real acquisition spend, so "delete" means "leave the
    // live app," not "destroy the data" — the admin console can browse all of
    // it via /admin/deleted-users. Safety: never touch the live row unless
    // archiving succeeded — an archive failure must not be able to lose data.
    let archive;
    try {
      archive = await archiveUserContent(userId);
    } catch (archiveErr: unknown) {
      const message = archiveErr instanceof Error ? archiveErr.message : 'Archive failed';
      return NextResponse.json({ error: `Failed to archive account data: ${message}` }, { status: 500 });
    }

    // Lightweight identity/usage record for admin quick-glance and abuse
    // tracking (provider-subject/email hashing for repeat-offender matching).
    // The avatar URL is the rewritten (post-move) path, matching where the
    // file actually lives now — the pre-archive URL in `profile` would 404.
    const { error: auditErr } = await supabaseAdmin
      .from('user_deletion_audit')
      .insert({
        deleted_user_id: userId,
        deleted_at: new Date().toISOString(),
        provider: appleIdentity?.provider ?? null,
        provider_subject_hash: providerSubjectHash,
        email_hash: emailHash,
        profile_snapshot: profile ? { ...profile, avatar: archive.archivedAvatarUrl } : null,
        usage_snapshot: usageSnapshot,
      });

    if (auditErr) {
      return NextResponse.json({ error: auditErr.message }, { status: 500 });
    }

    // 3) SOFT-DELETE + WIPE THE LIVE ROW. Account deletion is NOT a refund, so
    //    we must keep the user row and (crucially) their `subscription` rows
    //    for billing/ops visibility in the admin console. We therefore do NOT
    //    hard-delete the Supabase Auth user — that cascades `public.users` (FK
    //    ON DELETE CASCADE) and wipes the subscription. Instead we set
    //    `deleted_at` AND reset every profile field to its bootstrap default:
    //    everything just archived above is what a returning sign-in with the
    //    same provider will NOT see — they go through clean onboarding on a
    //    blank account (see the iOS profile GET/PATCH fresh-start restore,
    //    which only clears `deleted_at`), while the real data lives on
    //    permanently in the archive for the business to review.
    const nowIso = new Date().toISOString();
    const { error: softErr } = await supabaseAdmin
      .from('users')
      .update({ ...FRESH_PROFILE_FIELDS, deleted_at: nowIso })
      .eq('userid', userId);
    if (softErr) {
      return NextResponse.json({ error: softErr.message }, { status: 500 });
    }

    // Clear posts/matches/messages (now safely archived above) plus pending
    // invites, swipes, push tokens, and safety rows — state/gating data that
    // has no business value archived — so the live tables are genuinely clean
    // for a fresh start.
    await purgeUserContent(userId);

    return NextResponse.json({
      success: true,
      archived: {
        posts: archive.postsArchived,
        matches: archive.matchesArchived,
        messages: archive.messagesArchived,
      },
    });
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
