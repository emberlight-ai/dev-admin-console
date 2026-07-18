import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withLogging } from '@/lib/with-logging';
import { supabaseAdmin } from '@/lib/supabase';
import { syntheticLikes } from '@/lib/synthetic-likes';

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
 * GET /api/ios/feed?category=<key>&cursor=<created_at>&limit=10
 *
 * Category post feed: posts from digital humans tagged with any interest
 * under the given Explore category (same expansion getMatchings uses),
 * dormant tier excluded, keyset-paginated. Each post carries its author card,
 * display like count (synthetic popularity + real likes) and liked_by_me.
 * Without `category` it serves all visible DHs (reserved for a future
 * global feed).
 *
 * Deliberately NO embedded-resource filters: author eligibility is resolved
 * first (users ∩ user_interests), then posts are fetched by author id — the
 * `or(..., { foreignTable })` construct silently no-ops on newer supabase-js
 * (renamed to referencedTable), which is exactly the bug that shipped an
 * empty feed v1.
 */
async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '10', 10) || 10, 1), 30);
    // The cursor is an ISO timestamptz. Clients that don't percent-encode the
    // `+` in `+00:00` (Swift URLComponents leaves it literal) arrive here with
    // it decoded as a space — restore it, a space can't occur in a valid cursor.
    const cursor = searchParams.get('cursor')?.replace(/ /g, '+') || null;
    const category = (searchParams.get('category') || '').trim().toLowerCase();

    const userClient = getUserSupabase(req);
    const { data: auth } = await userClient.auth.getUser();
    const me = auth?.user?.id;
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 1. Eligible authors: visible DHs (not deleted, not dormant), optionally
    //    narrowed to the category's tagged members.
    let taggedIds: string[] | null = null;
    if (category) {
      const { data: interestRows } = await supabaseAdmin
        .from('interests')
        .select('key')
        .eq('category_key', category);
      const keys = new Set<string>([category]);
      for (const r of interestRows ?? []) keys.add((r as { key: string }).key);

      const { data: tagRows } = await supabaseAdmin
        .from('user_interests')
        .select('user_id')
        .in('interest_key', [...keys]);
      taggedIds = [...new Set((tagRows ?? []).map((r) => (r as { user_id: string }).user_id))];
      if (taggedIds.length === 0) {
        return NextResponse.json({ posts: [], nextCursor: null, hasMore: false });
      }
    }

    let authorsQ = supabaseAdmin
      .from('users')
      .select('userid, username, avatar, age, strategy_key')
      .eq('is_digital_human', true)
      .is('deleted_at', null);
    if (taggedIds) authorsQ = authorsQ.in('userid', taggedIds.slice(0, 500));
    const { data: authorRows, error: authorsErr } = await authorsQ;
    if (authorsErr) return NextResponse.json({ error: authorsErr.message }, { status: 400 });

    const authors = (authorRows ?? []).filter(
      (a) => (a.strategy_key ?? '') !== 'dormant'
    );
    const authorById = new Map(authors.map((a) => [a.userid as string, a]));
    const authorIds = authors.map((a) => a.userid as string);
    if (authorIds.length === 0) {
      return NextResponse.json({ posts: [], nextCursor: null, hasMore: false });
    }

    // 2. Their posts, newest first, keyset on created_at.
    let postsQ = supabaseAdmin
      .from('user_posts')
      .select('id, userid, description, photos, location_name, occurred_at, created_at')
      .in('userid', authorIds.slice(0, 500))
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (cursor) postsQ = postsQ.lt('created_at', cursor);
    const { data: postRows, error: postsErr } = await postsQ;
    if (postsErr) return NextResponse.json({ error: postsErr.message }, { status: 400 });

    const page = (postRows ?? []).slice(0, limit);
    const hasMore = (postRows ?? []).length > limit;
    const postIds = page.map((p) => p.id as string);
    const pageAuthorIds = [...new Set(page.map((p) => p.userid as string))];

    // 3. Popularity (synthetic base) for this page's authors.
    const matchCounts: Record<string, number> = {};
    if (pageAuthorIds.length > 0) {
      const { data: matches } = await supabaseAdmin.from('user_matches').select('user_a, user_b');
      const wanted = new Set(pageAuthorIds);
      for (const m of matches ?? []) {
        const { user_a: a, user_b: b } = m as { user_a: string; user_b: string };
        if (wanted.has(a)) matchCounts[a] = (matchCounts[a] ?? 0) + 1;
        if (wanted.has(b)) matchCounts[b] = (matchCounts[b] ?? 0) + 1;
      }
    }

    // 4. Real likes + the caller's own.
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
      const id = p.id as string;
      const authorId = p.userid as string;
      const author = authorById.get(authorId);
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
          userid: authorId,
          username: author?.username ?? null,
          avatar: author?.avatar ?? null,
          age: author?.age ?? null,
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
