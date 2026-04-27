import type { SupabaseClient } from '@supabase/supabase-js';

type Body = {
  count?: unknown;
  image_count?: unknown;
  imageCount?: unknown;
  gender_filter?: unknown;
  digitalHumansOnly?: unknown;
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

  const { data: users, error: usersErr } = await supabase.rpc(
    'rpc_get_matching_candidates',
    {
      viewer_user_id: viewerUserId,
      limit_count: count,
      gender_filter: genderFilter,
      digital_humans_only: digitalHumansOnly,
    }
  );

  if (usersErr) throw new Error(usersErr.message);

  const candidates = (users as Candidate[]).slice(0, count);

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

    cards.push({
      userId: u.userid,
      avatar: u.avatar,
      username: u.username,
      age: u.age,
      gender: u.gender,
      bio: u.bio,
      profession: u.profession,
      postImages: images,
    });
  }

  return cards;
}


