import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withLogging } from '@/lib/with-logging';

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

async function handlePOST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const body = await req.json();

    // Body should contain { description, location_name, longitude, latitude, photos... }
    // We enforce userid = auth.uid() in RLS, but for insert we need to pass it or let DB default?
    // DB requires userid. We should set it from auth.uid() or let the client pass it.
    // Safest is to extract user from token or just trust RLS.
    // Since we are proxying, let's inject the userid from the session or just pass the body.
    // However, if the client passes a different userid, RLS will block it.
    // Ideally we decode the token to get the ID, but let's just pass the body.
    // If the body is missing userid, the insert will fail (not null).
    
    // Better: get user from auth and inject it.
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const postData = { ...body, userid: user.id };

    const { data, error } = await supabase
      .from('user_posts')
      .insert(postData)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

export const POST = withLogging(handlePOST);

