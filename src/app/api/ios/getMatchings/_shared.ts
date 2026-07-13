import type { SupabaseClient } from '@supabase/supabase-js';

type Body = {
  count?: unknown;
  image_count?: unknown;
  imageCount?: unknown;
  gender_filter?: unknown;
  digitalHumansOnly?: unknown;
  /** Optional interest keys (Explore category pages). Array or comma-separated string. */
  categories?: unknown;
};

type Candidate = {
  userid: string;
  avatar: string | null;
  username: string;
  age: number | null;
  gender: string | null;
  bio: string | null;
  profession: string | null;
  is_digital_human: boolean | null;
  personality: string | null;
  whitelisted: boolean | null;
};

export type MatchingsCard = {
  userId: string;
  avatar: string | null;
  username: string;
  age: number | null;
  gender: string | null;
  bio: string | null;
  profession: string | null;
  postImages: string[];
  // Admin-curated "featured" flag (`users.whitelisted`). Exposed to the iOS deck as
  // `is_vip` (the semantic the client uses to render the VIP gold style); `whitelisted`
  // is kept as the raw alias for compatibility.
  whitelisted: boolean;
  is_vip: boolean;
  /** Interest keys for the card's tag chips. Additive — old clients ignore it. */
  interests: string[];
};

function clampInt(v: unknown, def: number, min: number, max: number) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function optionalString(v: unknown) {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** ["a","b"], "a,b" or "a" → ["a","b"]; anything else → null (no filter). */
function parseCategories(v: unknown): string[] | null {
  const list = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(',')
      : null;
  if (!list) return null;
  const keys = list
    .filter((k): k is string => typeof k === 'string')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0 && k.length <= 64);
  return keys.length > 0 ? keys : null;
}

export async function buildMatchingsFeed(opts: {
  supabase: SupabaseClient;
  viewerUserId: string;
  body: Body;
}): Promise<MatchingsCard[]> {
  const { supabase, viewerUserId, body } = opts;
  const count = clampInt(body.count, 20, 1, 50);
  const imageCount = clampInt(body.image_count ?? body.imageCount, 7, 1, 20);
  const genderFilter = optionalString(body.gender_filter);
  const digitalHumansOnly = body.digitalHumansOnly === true;
  const categories = parseCategories(body.categories);

  const { data: users, error: usersErr } = await supabase.rpc(
    'rpc_get_matching_candidates',
    {
      viewer_user_id: viewerUserId,
      limit_count: count,
      gender_filter: genderFilter,
      digital_humans_only: digitalHumansOnly,
      // NULL keeps the exact pre-interests behavior (defaulted param).
      interest_filter: categories,
    }
  );

  if (usersErr) throw new Error(usersErr.message);

  const candidates = (users as Candidate[]).slice(0, count);

  // One batched read for every candidate's interest tags (card chips).
  // Best-effort: a failure here must never break the deck.
  const interestsByUser = new Map<string, string[]>();
  if (candidates.length > 0) {
    const { data: interestRows } = await supabase
      .from('user_interests')
      .select('user_id, interest_key')
      .in('user_id', candidates.map((c) => c.userid));
    for (const row of interestRows ?? []) {
      const r = row as { user_id: string; interest_key: string };
      const list = interestsByUser.get(r.user_id) ?? [];
      list.push(r.interest_key);
      interestsByUser.set(r.user_id, list);
    }
  }

  const cards: MatchingsCard[] = [];
  for (const u of candidates) {
    const { data: posts, error: postsErr } = await supabase
      .from('user_posts')
      .select('photos,occurred_at,created_at')
      .eq('userid', u.userid)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);

    if (postsErr) throw new Error(postsErr.message);

    const images: string[] = [];
    for (const p of posts ?? []) {
      const photos = (p as { photos?: unknown }).photos;
      if (Array.isArray(photos)) {
        for (const url of photos) {
          if (typeof url === 'string' && url.length) {
            images.push(url);
            if (images.length >= imageCount) break;
          }
        }
      }
      if (images.length >= imageCount) break;
    }

    const isVip = u.whitelisted ?? false;
    cards.push({
      userId: u.userid,
      avatar: u.avatar,
      username: u.username,
      age: u.age,
      gender: u.gender,
      bio: u.bio,
      profession: u.profession,
      postImages: images,
      whitelisted: isVip,
      is_vip: isVip,
      interests: interestsByUser.get(u.userid) ?? [],
    });
  }

  return cards;
}


