import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { buildMatchingsFeed } from '@/app/api/ios/getMatchings/_shared';
import { withLogging } from '@/lib/with-logging';

type MatchingsRequestBody = {
  count?: unknown;
  image_count?: unknown;
  gender_filter?: unknown;
};

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

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const requestBody = (body && typeof body === 'object' ? body : {}) as MatchingsRequestBody;

    const cards = await buildMatchingsFeed({
      supabase,
      viewerUserId: authData.user.id,
      body: {
        count: requestBody.count,
        image_count: requestBody.image_count,
        gender_filter: requestBody.gender_filter,
      },
    });

    return NextResponse.json(cards);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}


export const POST = withLogging(handlePOST);
