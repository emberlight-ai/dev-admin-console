import type { SupabaseClient } from '@supabase/supabase-js';

type Body = {
  visitedUserIds?: unknown;
  count?: unknown;
  imageCount?: unknown;
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

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function clampInt(v: unknown, def: number, min: number, max: number) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function toPostgrestInList(values: string[]) {
  // PostgREST expects "(a,b,c)" without quotes for uuid/text values.
  // Note: values are not user-entered (UUIDs), but we still strip any parens/commas just in case.
  const cleaned = values
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => v.replace(/[(),]/g, ''));
  return `(${cleaned.join(',')})`;
}

export async function buildMatchingsFeed(opts: {
  supabase: SupabaseClient;
  viewerUserId: string;
  body: Body;
}): Promise<MatchingsCard[]> {
  const { supabase, viewerUserId, body } = opts;
  const visitedUserIds = asStringArray(body.visitedUserIds);
  const count = clampInt(body.count, 20, 1, 50);
  const imageCount = clampInt(body.imageCount, 7, 1, 20);

  const exclude = Array.from(new Set([viewerUserId, ...visitedUserIds]));

  const { data: users, error: usersErr } = await supabase.rpc(
    'rpc_get_matching_candidates',
    {
      viewer_user_id: viewerUserId,
      visited_user_ids: visitedUserIds,
      limit_count: count,
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


