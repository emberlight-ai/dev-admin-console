import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withLogging } from '@/lib/with-logging';
import { supabaseAdmin } from '@/lib/supabase';

// Deterministic 0..1 from a string (FNV-1a). Same post always hashes the same,
// so like counts are STABLE across visits and pagination — believability rule #1.
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Social-proof likes for DIGITAL HUMAN posts: popularity (total matches) sets
 * the budget, the post-id hash spreads it — likes_i = matches × (0.4..2.0).
 * A 200-match DH shows 80–400 likes per post; a fresh DH shows a handful;
 * numbers grow naturally as her match count grows. Real users' posts get no
 * synthetic likes (there is no real like system yet — additive field, old
 * clients ignore it).
 */
function syntheticLikes(postId: string, dhId: string, matches: number): number {
  if (matches <= 0) return 0;
  return Math.floor(matches * (0.4 + 1.6 * hash01(postId + dhId)));
}

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

async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  try {
    const { userid } = await params;
    const { searchParams } = new URL(req.url);
    const startIndex = parseInt(searchParams.get('startIndex') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '5', 10);
    const hasLocation = searchParams.get('hasLocation') === 'true';

    const supabase = getUserSupabase(req);

    // Call the RPC 'rpc_get_user_posts' which handles pagination and location filtering
    const { data, error } = await supabase.rpc('rpc_get_user_posts', {
      target_user_id: userid,
      start_index: startIndex,
      limit_count: limit,
      has_location: hasLocation,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Display likes = synthetic popularity (DH profiles only) + REAL likes
    // (post_likes), plus whether the caller already liked each post.
    let posts = data;
    try {
      if (Array.isArray(posts) && posts.length > 0) {
        const postIds = posts.map((p: { id: string }) => String(p.id));
        const { data: auth } = await supabase.auth.getUser();
        const me = auth?.user?.id ?? null;

        const [{ data: target }, { data: likeRows }, { data: mine }] = await Promise.all([
          supabaseAdmin.from('users').select('is_digital_human').eq('userid', userid).maybeSingle(),
          supabaseAdmin.from('post_likes').select('post_id').in('post_id', postIds),
          me
            ? supabaseAdmin.from('post_likes').select('post_id').in('post_id', postIds).eq('user_id', me)
            : Promise.resolve({ data: [] as Array<{ post_id: string }> }),
        ]);

        let matches = 0;
        if (target?.is_digital_human) {
          const [{ count: asA }, { count: asB }] = await Promise.all([
            supabaseAdmin.from('user_matches').select('id', { count: 'exact', head: true }).eq('user_a', userid),
            supabaseAdmin.from('user_matches').select('id', { count: 'exact', head: true }).eq('user_b', userid),
          ]);
          matches = (asA ?? 0) + (asB ?? 0);
        }

        const realCounts: Record<string, number> = {};
        for (const r of likeRows ?? []) {
          const id = (r as { post_id: string }).post_id;
          realCounts[id] = (realCounts[id] ?? 0) + 1;
        }
        const likedByMe = new Set((mine ?? []).map((r) => (r as { post_id: string }).post_id));

        posts = posts.map((p: { id: string }) => {
          const id = String(p.id);
          const synthetic = target?.is_digital_human ? syntheticLikes(id, userid, matches) : 0;
          return {
            ...p,
            likes: synthetic + (realCounts[id] ?? 0),
            liked_by_me: likedByMe.has(id),
          };
        });
      }
    } catch {
      // Social proof is decoration — never let it break the posts feed.
    }

    return NextResponse.json(posts);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

export const GET = withLogging(handleGET);

