import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withLogging } from '@/lib/with-logging';
import { supabaseAdmin } from '@/lib/supabase';

// Same deterministic synthetic-likes recipe as the profile posts endpoint:
// popularity (matches) × hash(post+author) in 0.4..2.0. Stable everywhere.
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10000) / 10000;
}
function syntheticLikes(postId: string, dhId: string, matches: number): number {
  if (matches <= 0) return 0;
  return Math.floor(matches * (0.4 + 1.6 * hash01(postId + dhId)));
}

type FeedRow = {
  id: string;
  userid: string;
  description: string | null;
  photos: string[] | null;
  location_name: string | null;
  occurred_at: string | null;
  created_at: string;
  users: {
    userid: string; username: string | null; avatar: string | null;
    age: number | null; personality: string | null;
  };
};

const getUserSupabase = (req: NextRequest) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Missing Authorization header');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );
};

/**
 * GET /api/ios/feed?cursor=<created_at>&limit=10
 *
 * The Explore feed: recent posts from visible digital humans (dormant tier
 * excluded), keyset-paginated, each with its author card, display like count
 * (synthetic popularity + real likes) and whether the caller liked it.
 */
async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '10', 10) || 10, 1), 30);
    const cursor = searchParams.get('cursor');

    // Caller identity (for liked_by_me) — feed content itself is public-ish.
    const userClient = getUserSupabase(req);
    const { data: auth } = await userClient.auth.getUser();
    const me = auth?.user?.id;
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let q = supabaseAdmin
      .from('user_posts')
      .select(
        'id, userid, description, photos, location_name, occurred_at, created_at, ' +
          'users!inner(userid, username, avatar, age, personality, is_digital_human, deleted_at, strategy_key)'
      )
      .is('deleted_at', null)
      .eq('users.is_digital_human', true)
      .is('users.deleted_at', null)
      // Dormant = the hidden shelf; its DHs don't appear anywhere user-facing.
      .or('strategy_key.neq.dormant,strategy_key.is.null', { foreignTable: 'users' })
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (cursor) q = q.lt('created_at', cursor);

    const { data: rowsRaw, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // The embedded-select string defeats supabase-js type inference — the
    // shape is exactly FeedRow (users!inner = single parent object).
    const rows = (rowsRaw ?? []) as unknown as FeedRow[];
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const postIds = page.map((p) => p.id);
    const authorIds = [...new Set(page.map((p) => p.userid))];

    // Popularity (synthetic base): count match participations per author.
    // user_matches is small — count in JS, same as the whitelist page did.
    const matchCounts: Record<string, number> = {};
    if (authorIds.length > 0) {
      const { data: matches } = await supabaseAdmin.from('user_matches').select('user_a, user_b');
      const wanted = new Set(authorIds);
      for (const m of matches ?? []) {
        const { user_a: a, user_b: b } = m as { user_a: string; user_b: string };
        if (wanted.has(a)) matchCounts[a] = (matchCounts[a] ?? 0) + 1;
        if (wanted.has(b)) matchCounts[b] = (matchCounts[b] ?? 0) + 1;
      }
    }

    // Real likes on this page + which the caller already liked.
    const realCounts: Record<string, number> = {};
    const likedByMe = new Set<string>();
    if (postIds.length > 0) {
      const [{ data: likeRows }, { data: mine }] = await Promise.all([
        supabaseAdmin.from('post_likes').select('post_id').in('post_id', postIds),
        supabaseAdmin.from('post_likes').select('post_id').in('post_id', postIds).eq('user_id', me),
      ]);
      for (const r of likeRows ?? []) {
        const id = (r as { post_id: string }).post_id;
        realCounts[id] = (realCounts[id] ?? 0) + 1;
      }
      for (const r of mine ?? []) likedByMe.add((r as { post_id: string }).post_id);
    }

    const posts = page.map((p) => {
      const author = p.users;
      const id = p.id;
      const authorId = p.userid;
      return {
        id,
        userid: authorId,
        description: p.description,
        photos: p.photos,
        location_name: p.location_name,
        occurred_at: p.occurred_at,
        created_at: p.created_at,
        likes: syntheticLikes(id, authorId, matchCounts[authorId] ?? 0) + (realCounts[id] ?? 0),
        liked_by_me: likedByMe.has(id),
        author: {
          userid: author.userid,
          username: author.username,
          avatar: author.avatar,
          age: author.age,
        },
      };
    });

    return NextResponse.json({
      posts,
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1].created_at : null,
      hasMore,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

export const GET = withLogging(handleGET);
