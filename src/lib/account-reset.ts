import { supabaseAdmin } from '@/lib/supabase';

// Fresh-start values for every user-entered profile field on public.users.
// Applied when an account is deleted (PII leaves the live row immediately —
// the user_deletion_audit snapshot is the only retained copy) and again on
// re-signin restore, so accounts deleted before this wipe existed also come
// back clean. Ops fields (whitelisted, dh_engine, is_digital_human) and
// billing rows (subscription, apple_purchase) are untouched.
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

/// Remove all of a user's content and social graph so a returning sign-in
/// starts from a blank account. Everything deleted here was snapshotted into
/// user_deletion_audit by the delete route before this runs. Deleting
/// user_matches cascades messages, user_match_ai_state, dh_match_memory and
/// dh_sent_images, so the old conversations (and the DH's memory of them)
/// cannot resurface in the fresh account.
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
