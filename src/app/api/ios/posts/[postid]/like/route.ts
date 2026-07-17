import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withLogging } from '@/lib/with-logging';

// User-scoped client: RLS enforces user_id = auth.uid() on writes, so this
// route can't like on someone else's behalf even if it wanted to.
const getUserSupabase = (req: NextRequest) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Missing Authorization header');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );
};

/** POST /api/ios/posts/[postid]/like — like (idempotent). */
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ postid: string }> }
) {
  try {
    const { postid } = await params;
    const supabase = getUserSupabase(req);
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { error } = await supabase
      .from('post_likes')
      .upsert({ post_id: postid, user_id: userId }, { onConflict: 'post_id,user_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, liked: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

/** DELETE /api/ios/posts/[postid]/like — unlike (idempotent). */
async function handleDELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postid: string }> }
) {
  try {
    const { postid } = await params;
    const supabase = getUserSupabase(req);
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { error } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postid)
      .eq('user_id', userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, liked: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

export const POST = withLogging(handlePOST);
export const DELETE = withLogging(handleDELETE);
