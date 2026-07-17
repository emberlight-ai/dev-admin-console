import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withLogging } from '@/lib/with-logging';
import { supabaseAdmin } from '@/lib/supabase';
import { syntheticLikes } from '@/lib/synthetic-likes';

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

    // FRIEND GATE (server-enforced, works for old clients too): a caller who
    // isn't matched with the target sees only the FIRST moment — the rest
    // unlock by CONNECTING, not by paying. Own profile is never gated.
    let posts = data;
    try {
      if (Array.isArray(posts) && posts.length > 0) {
        const { data: callerAuth } = await supabase.auth.getUser();
        const callerId = callerAuth?.user?.id ?? null;
        if (callerId && callerId !== userid) {
          const [a, b] = callerId < userid ? [callerId, userid] : [userid, callerId];
          const { count } = await supabaseAdmin
            .from('user_matches')
            .select('id', { count: 'exact', head: true })
            .eq('user_a', a)
            .eq('user_b', b);
          const connected = (count ?? 0) > 0;
          if (!connected) {
            posts = startIndex === 0 ? posts.slice(0, 1) : [];
          }
        }
      }
    } catch {
      // Fail open on the gate check — a transient error must not blank profiles.
    }
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

