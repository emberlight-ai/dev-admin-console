import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withLogging } from '@/lib/with-logging';
import { supabaseAdmin } from '@/lib/supabase';
import { hash01, syntheticLikes } from '@/lib/synthetic-likes';

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
 * GET /api/ios/feed?category=<key>&seed=<any>&cursor=<created_at|offset>&limit=10
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
    const seed = (searchParams.get('seed') || '').trim();
    const category = (searchParams.get('category') || '').trim().toLowerCase();

    const userClient = getUserSupabase(req);
    const { data: auth } = await userClient.auth.getUser();
    const me = auth?.user?.id;
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 1. Eligible authors: visible DHs (not deleted, not dormant), optionally
    //    narrowed to the category's tagged members.
    let taggedIds: string[] | null = null;
    const categoryKeys: string[] = [];
    if (category) {
      const { data: interestRows } = await supabaseAdmin
        .from('interests')
        .select('key')
        .eq('category_key', category);
      const keys = new Set<string>([category]);
      for (const r of interestRows ?? []) keys.add((r as { key: string }).key);
      categoryKeys.push(...keys);

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

    // 2. The page of posts.
    //    With a `seed` (current clients): a deterministic shuffle — every post
    //    id hashed with the seed, sorted by hash, then de-runed so the same
    //    author never appears twice in a row while another author remains.
    //    The client mints a fresh seed per feed-open, so each visit is a new
    //    mix, while pagination inside one visit stays stable (cursor = offset
    //    into the shuffled order).
    //    Without a seed (older builds): newest-first keyset on created_at.
    const POST_COLS = 'id, userid, description, photos, location_name, occurred_at, created_at';
    type PostRow = {
      id: string; userid: string; description: string | null; photos: unknown;
      location_name: string | null; occurred_at: string | null; created_at: string;
    };
    let page: PostRow[] = [];
    let hasMore = false;
    let nextCursor: string | null = null;

    // Synthetic posts from the shared image library (API-level blend, no DB
    // rows): active CASUAL-tier images — tease/reward are DM escalation
    // tiers and must never surface on a public feed — matched to the
    // category by tag overlap, each "authored" by an eligible DH that
    // shares at least one of the image's tags. Only the seeded path blends
    // them (the legacy keyset path can't paginate two sources).
    const syntheticById = new Map<string, PostRow>();

    if (seed) {
      const { data: idRows, error: idsErr } = await supabaseAdmin
        .from('user_posts')
        .select('id, userid')
        .in('userid', authorIds.slice(0, 500))
        .is('deleted_at', null)
        .limit(5000);
      if (idsErr) return NextResponse.json({ error: idsErr.message }, { status: 400 });

      type SharedImg = {
        id: string; public_url: string; description: string | null;
        post_content: string | null; interests: string[] | null;
        location_name: string | null; created_at: string;
      };
      let sharedQ = supabaseAdmin
        .from('shared_chat_images')
        .select('id, public_url, description, post_content, interests, location_name, created_at')
        .eq('active', true)
        .eq('tier', 'casual')
        .limit(1000);
      if (category) sharedQ = sharedQ.overlaps('interests', categoryKeys);
      // Blending is best-effort: a failure here degrades to the plain feed.
      const { data: sharedRows } = await sharedQ;

      if ((sharedRows ?? []).length > 0) {
        const { data: authorTagRows } = await supabaseAdmin
          .from('user_interests')
          .select('user_id, interest_key')
          .in('user_id', authorIds.slice(0, 500));
        const tagsByAuthor = new Map<string, Set<string>>();
        for (const r of authorTagRows ?? []) {
          const row = r as { user_id: string; interest_key: string };
          if (!tagsByAuthor.has(row.user_id)) tagsByAuthor.set(row.user_id, new Set());
          tagsByAuthor.get(row.user_id)!.add(row.interest_key);
        }

        for (const img of (sharedRows ?? []) as SharedImg[]) {
          const imgTags = img.interests ?? [];
          if (imgTags.length === 0) continue; // untagged — no honest author match
          const candidates = authorIds.filter((a) => {
            const t = tagsByAuthor.get(a);
            return t != null && imgTags.some((k) => t.has(k));
          });
          if (candidates.length === 0) continue;

          // Author pick is SEED-INDEPENDENT (image id ⊕ author id): the same
          // photo must keep the same "author" across visits — an identity
          // that changes between feed opens reads as fake.
          let author = candidates[0];
          let best = 2;
          for (const c of candidates) {
            const h = hash01(img.id + c);
            if (h < best) { best = h; author = c; }
          }

          const sid = `shared_${img.id}`;
          syntheticById.set(sid, {
            id: sid,
            userid: author,
            description: (img.post_content ?? '').trim() || img.description,
            photos: [img.public_url],
            location_name: img.location_name,
            occurred_at: null,
            created_at: img.created_at,
          });
        }
      }

      const order = [
        ...(idRows ?? []).map((r) => {
          const id = r.id as string;
          return { id, userid: r.userid as string, h: hash01(seed + id) };
        }),
        ...[...syntheticById.values()].map((p) => ({
          id: p.id, userid: p.userid, h: hash01(seed + p.id),
        })),
      ].sort((a, b) => a.h - b.h || a.id.localeCompare(b.id));
      for (let i = 1; i < order.length; i++) {
        if (order[i].userid !== order[i - 1].userid) continue;
        let j = i + 1;
        while (j < order.length && order[j].userid === order[i - 1].userid) j++;
        if (j >= order.length) break; // only this author remains — runs are unavoidable
        const [moved] = order.splice(j, 1);
        order.splice(i, 0, moved);
      }

      const offset = cursor ? Math.max(parseInt(cursor, 10) || 0, 0) : 0;
      const pageIds = order.slice(offset, offset + limit).map((r) => r.id);
      hasMore = offset + limit < order.length;
      nextCursor = hasMore ? String(offset + limit) : null;

      if (pageIds.length > 0) {
        // Synthetic ids aren't user_posts uuids — resolve them locally and
        // only query the DB for the real ones.
        const realIds = pageIds.filter((id) => !syntheticById.has(id));
        const byId = new Map<string, PostRow>();
        if (realIds.length > 0) {
          const { data: rows, error: rowsErr } = await supabaseAdmin
            .from('user_posts')
            .select(POST_COLS)
            .in('id', realIds);
          if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 400 });
          for (const r of rows ?? []) byId.set(r.id as string, r as PostRow);
        }
        page = pageIds
          .map((id) => syntheticById.get(id) ?? byId.get(id))
          .filter((p): p is PostRow => Boolean(p));
      }
    } else {
      let postsQ = supabaseAdmin
        .from('user_posts')
        .select(POST_COLS)
        .in('userid', authorIds.slice(0, 500))
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit + 1);
      if (cursor) postsQ = postsQ.lt('created_at', cursor);
      const { data: postRows, error: postsErr } = await postsQ;
      if (postsErr) return NextResponse.json({ error: postsErr.message }, { status: 400 });

      page = ((postRows ?? []) as PostRow[]).slice(0, limit);
      hasMore = (postRows ?? []).length > limit;
      nextCursor = hasMore && page.length > 0 ? page[page.length - 1].created_at : null;
    }
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

    // 4. Real likes + the caller's own. Synthetic posts have no post_likes
    //    rows (their like taps are acked but not persisted) — and their ids
    //    aren't uuids, so they must stay out of the .in() filters.
    const realCounts: Record<string, number> = {};
    const likedByMe = new Set<string>();
    const likablePostIds = postIds.filter((id) => !id.startsWith('shared_'));
    if (likablePostIds.length > 0) {
      const [{ data: likeRows }, { data: mine }] = await Promise.all([
        supabaseAdmin.from('post_likes').select('post_id').in('post_id', likablePostIds),
        supabaseAdmin.from('post_likes').select('post_id').in('post_id', likablePostIds).eq('user_id', me),
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

    return NextResponse.json({ posts, nextCursor, hasMore });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

export const GET = withLogging(handleGET);
