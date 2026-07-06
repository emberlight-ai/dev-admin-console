import { supabaseAdmin } from '@/lib/supabase';
import {
  archiveMatchMediaFolders,
  archiveUserImagesFolder,
  rewriteArchivedUrl,
} from '@/lib/archive-storage';

// Fresh-start values for every user-entered profile field on public.users.
// Applied when an account is deleted (the LIVE row goes blank — see
// archiveUserContent below for where the actual data goes) and again on
// re-signin restore, so accounts deleted before this existed also come back
// clean. Ops fields (whitelisted, dh_engine, is_digital_human) and billing
// rows (subscription, apple_purchase) are untouched.
export const FRESH_PROFILE_FIELDS = {
  username: '',
  age: null,
  gender: null,
  personality: null,
  zipcode: null,
  phone: null,
  bio: null,
  education: null,
  profession: null,
  avatar: null,
  location_name: null,
  longitude: null,
  latitude: null,
  timezone: null,
  notification_enabled: false,
  location_enabled: false,
};

export type ArchiveResult = {
  postsArchived: number;
  matchesArchived: number;
  messagesArchived: number;
  /// The user's avatar URL rewritten to its new archived storage path (or null
  /// if they had none). Callers building a profile snapshot around the same
  /// moment should use this instead of the pre-archive `users.avatar` value,
  /// which now 404s — the file has moved.
  archivedAvatarUrl: string | null;
};

const IMAGES_BUCKET = 'images';
const CHAT_MEDIA_BUCKET = 'chat_media';

/// Preserves everything a deleted user (or their content) owns — posts with
/// photos, matches, full message transcripts — by COPYING it into the
/// `archived_*` tables and moving the underlying storage objects into an
/// `archived/` folder in the same bucket. This app is not GDPR-scoped and
/// every user represents real acquisition spend, so deletion is not
/// destruction: it's "remove from the live app, keep for the business."
///
/// Must run BEFORE `purgeUserContent` — that's what actually empties the live
/// tables so a re-signin with the same identity gets a genuinely blank
/// account. Idempotent (upserts on the original row id), so a retried delete
/// request never double-archives.
export async function archiveUserContent(userId: string): Promise<ArchiveResult> {
  // 1) Move this user's own storage folder first — avatar + post photos live
  //    under one prefix regardless of naming scheme, so one move covers both.
  await archiveUserImagesFolder(userId);
  const rewriteAvatar = (url: string | null | undefined) =>
    rewriteArchivedUrl(url, IMAGES_BUCKET, `${userId}/`, `archived/${userId}/`);
  const rewritePostPhotos = (photos: string[] | null | undefined) =>
    (photos ?? []).map((p) => rewriteAvatar(p) ?? p);

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('avatar')
    .eq('userid', userId)
    .maybeSingle();
  const archivedAvatarUrl = rewriteAvatar(userRow?.avatar as string | null | undefined);

  // 2) Posts: copy every row (their own deleted_at is irrelevant — we archive
  //    everything, including posts already soft-deleted by the user).
  const { data: posts, error: postsErr } = await supabaseAdmin
    .from('user_posts')
    .select('*')
    .eq('userid', userId);
  if (postsErr) throw new Error(`archive posts: ${postsErr.message}`);

  if (posts && posts.length > 0) {
    const rows = posts.map((p) => ({
      id: p.id,
      deleted_user_id: userId,
      photos: rewritePostPhotos(p.photos as string[] | null),
      description: p.description,
      location_name: p.location_name,
      longitude: p.longitude,
      latitude: p.latitude,
      altitude: p.altitude,
      occurred_at: p.occurred_at,
      created_at: p.created_at,
    }));
    const { error } = await supabaseAdmin
      .from('archived_user_posts')
      .upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`archive posts write: ${error.message}`);
  }

  // 3) Matches: copy every match this user is part of, with the counterpart's
  //    identity snapshotted (they may also delete/change their profile later).
  const { data: matches, error: matchesErr } = await supabaseAdmin
    .from('user_matches')
    .select('*')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);
  if (matchesErr) throw new Error(`archive matches: ${matchesErr.message}`);

  const matchIds = (matches ?? []).map((m) => m.id as string);
  const counterpartIds = (matches ?? []).map((m) =>
    m.user_a === userId ? (m.user_b as string) : (m.user_a as string)
  );

  const counterpartById = new Map<string, { username: string | null; avatar: string | null }>();
  if (counterpartIds.length > 0) {
    const { data: counterparts } = await supabaseAdmin
      .from('users')
      .select('userid, username, avatar')
      .in('userid', counterpartIds);
    for (const c of counterparts ?? []) {
      counterpartById.set(c.userid as string, {
        username: c.username as string | null,
        avatar: c.avatar as string | null,
      });
    }
  }

  if (matches && matches.length > 0) {
    const rows = matches.map((m) => {
      const otherId = m.user_a === userId ? m.user_b : m.user_a;
      const other = counterpartById.get(otherId as string);
      return {
        id: m.id,
        deleted_user_id: userId,
        other_user_id: otherId,
        other_username: other?.username ?? null,
        other_avatar: other?.avatar ?? null,
        created_at: m.created_at,
      };
    });
    const { error } = await supabaseAdmin
      .from('archived_user_matches')
      .upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`archive matches write: ${error.message}`);
  }

  // 4) Chat media: move each match's shared media folder before archiving the
  //    message rows, so `media_url` can be rewritten to the surviving path.
  if (matchIds.length > 0) {
    await archiveMatchMediaFolders(matchIds);
  }

  // 5) Messages: full transcript for every archived match.
  let messagesArchived = 0;
  if (matchIds.length > 0) {
    const { data: messages, error: messagesErr } = await supabaseAdmin
      .from('messages')
      .select('*')
      .in('match_id', matchIds);
    if (messagesErr) throw new Error(`archive messages: ${messagesErr.message}`);

    if (messages && messages.length > 0) {
      const rows = messages.map((msg) => ({
        id: msg.id,
        match_id: msg.match_id,
        deleted_user_id: userId,
        sender_id: msg.sender_id,
        receiver_id: msg.receiver_id,
        content: msg.content,
        media_url: (() => {
          const matchId = msg.match_id as string;
          return rewriteArchivedUrl(
            msg.media_url as string | null,
            CHAT_MEDIA_BUCKET,
            `${matchId}/`,
            `archived/${matchId}/`
          );
        })(),
        image_desc: msg.image_desc,
        intimacy_score: msg.intimacy_score,
        created_at: msg.created_at,
      }));
      const { error } = await supabaseAdmin
        .from('archived_messages')
        .upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(`archive messages write: ${error.message}`);
      messagesArchived = rows.length;
    }
  }

  return {
    postsArchived: posts?.length ?? 0,
    matchesArchived: matches?.length ?? 0,
    messagesArchived,
    archivedAvatarUrl,
  };
}

/// Empties the LIVE tables so a returning sign-in with the same identity gets
/// a genuinely blank account. Call `archiveUserContent` first — everything
/// removed here should already have a permanent copy in the `archived_*`
/// tables (posts/matches/messages) or simply doesn't need preserving because
/// it's pure gating/state (requests, swipes, invite tracking, boost ledger)
/// rather than content. Deleting user_matches cascades messages,
/// user_match_ai_state, dh_match_memory and dh_sent_images.
export async function purgeUserContent(userId: string) {
  const results = await Promise.all([
    supabaseAdmin.from('user_posts').delete().eq('userid', userId),
    supabaseAdmin
      .from('user_matches')
      .delete()
      .or(`user_a.eq.${userId},user_b.eq.${userId}`),
    supabaseAdmin
      .from('match_requests')
      .delete()
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`),
    supabaseAdmin
      .from('swipe')
      .delete()
      .or(`swiper_user_id.eq.${userId},target_user_id.eq.${userId}`),
    supabaseAdmin
      .from('blocks')
      .delete()
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
    supabaseAdmin
      .from('reports')
      .delete()
      .or(`reporter_id.eq.${userId},target_user_id.eq.${userId}`),
    supabaseAdmin.from('user_push_tokens').delete().eq('user_id', userId),
    supabaseAdmin
      .from('digital_human_invites_tracking')
      .delete()
      .eq('user_id', userId),
    supabaseAdmin.from('scheduled_dh_invites').delete().eq('user_id', userId),
    // Boost ledger resets too: a fresh-start account is a new user, and every
    // new user gets their first Boost free (/api/ios/me/boost counts these
    // rows to decide). Boost purchases-by-subscription live in subscription/
    // apple_purchase, which are retained.
    supabaseAdmin.from('user_boost').delete().eq('user_id', userId),
  ]);

  const firstError = results.find((r) => r.error)?.error;
  if (firstError) throw new Error(firstError.message);
}
