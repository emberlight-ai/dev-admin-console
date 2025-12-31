import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userIds, startIndex = 0, limit = 200 } = body;

    if (!userIds || !Array.isArray(userIds)) {
      return NextResponse.json(
        { error: 'userIds array is required' },
        { status: 400 }
      );
    }

    const supabase = getUserSupabase(req);

    const { data, error } = await supabase
      .from('user_posts')
      .select('id, userid, occurred_at, longitude, latitude, altitude, location_name')
      .in('userid', userIds)
      .is('deleted_at', null)
      .or('geom.neq.null,location_name.neq.null')
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })
      .range(startIndex, startIndex + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Map to match the expected simplified response format
    const formattedData = data.map((post) => ({
      post_id: post.id,
      userid: post.userid,
      occurred_at: post.occurred_at,
      longitude: post.longitude,
      latitude: post.latitude,
      altitude: post.altitude,
      location_name: post.location_name,
    }));

    return NextResponse.json(formattedData);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}
