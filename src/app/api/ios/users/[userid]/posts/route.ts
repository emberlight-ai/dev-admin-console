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

export async function GET(
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

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal Server Error' },
      { status: err.message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

