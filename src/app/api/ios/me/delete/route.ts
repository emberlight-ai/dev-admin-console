import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
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

async function deleteUserImagesFolder(userId: string) {
  // Our storage paths are generally `${userId}/...` in the `images` bucket (see schema storage policy).
  const rootPrefix = `${userId}/`;
  const bucket = supabaseAdmin.storage.from('images');

  // Supabase storage listing is non-recursive; implement our own traversal.
  const limit = 1000;
  const maxPagesPerFolder = 200; // safety cap

  const folderQueue: string[] = [rootPrefix];

  while (folderQueue.length > 0) {
    const folder = folderQueue.shift()!;

    for (let page = 0; page < maxPagesPerFolder; page++) {
      const offset = page * limit;
      const { data: items, error } = await bucket.list(folder, {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      if (!items || items.length === 0) break;

      const filePaths: string[] = [];

      for (const it of items) {
        // Heuristic: folders generally have `id: null` and no metadata.
        const isFolder = (it as { id?: string | null }).id == null;
        if (isFolder) {
          folderQueue.push(`${folder}${it.name}/`);
        } else {
          filePaths.push(`${folder}${it.name}`);
        }
      }

      if (filePaths.length > 0) {
        const { error: removeErr } = await bucket.remove(filePaths);
        if (removeErr) throw removeErr;
      }

      if (items.length < limit) break;
    }
  }
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
        'userid, username, age, gender, personality, zipcode, phone, bio, education, profession, avatar, created_at, updated_at, deleted_at, is_digital_human'
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
    // These will be cascade-deleted once we delete the auth user.
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

    // 3) Best-effort: delete user-owned storage objects (not covered by FK cascades).
    try {
      await deleteUserImagesFolder(userId);
    } catch (storageErr: unknown) {
      // Don't block account deletion; return success but note cleanup warning.
      const msg =
        storageErr instanceof Error
          ? storageErr.message
          : 'storage cleanup failed';
      // Continue to delete auth user regardless (privacy first).
      console.warn('[deleteUserImagesFolder] failed:', msg);
    }

    // 4) Hard-delete the Supabase Auth user.
    // This also frees up the Apple identity so the same Apple ID can create a NEW auth.users row with a NEW id.
    // NOTE: Because public.users.userid references auth.users(id) ON DELETE CASCADE, deleting the auth user
    // will cascade-delete public.users and most app tables referencing it.
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

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
