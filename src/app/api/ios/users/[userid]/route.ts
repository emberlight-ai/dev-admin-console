import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

// Helper to create a user-context Supabase client
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

function unknownUser(userid: string) {
  // Return a stable shape for clients that expect a user object.
  // We intentionally keep it "empty" (no PII) while remaining parseable.
  const now = new Date().toISOString();
  return {
    userid,
    username: 'Unknown user',
    age: null,
    gender: null,
    personality: null,
    zipcode: null,
    phone: null,
    bio: null,
    education: null,
    profession: null,
    avatar: null,
    created_at: now,
    updated_at: now,
    deleted_at: now,
    is_digital_human: false,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  try {
    const { userid } = await params;
    // Return 200 for invalid/missing users (client-friendly behavior for iOS).
    if (!isUuid(userid)) {
      return NextResponse.json({ error: 'User not found' }, { status: 200 });
    }
    const supabase = getUserSupabase(req);

    // If requesting own profile, standard query.
    // If requesting other profile, use the public view or just the table if RLS permits.
    // The previous schema update allows any auth user to read 'users' table by id.

    // We can just query 'users' table directly.
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('userid', userid)
      .maybeSingle();

    if (error) {
      // PostgREST returns PGRST116 for 0 rows with `.single()`; with `.maybeSingle()` we may still
      // see coercion errors depending on gateway/version. Treat these as "not found".
      if (
        error.code === 'PGRST116' ||
        /Cannot coerce the result to a single JSON object/i.test(error.message)
      ) {
        return NextResponse.json(unknownUser(userid), { status: 200 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json(unknownUser(userid), { status: 200 });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  try {
    const { userid } = await params;
    const supabase = getUserSupabase(req);
    const body = await req.json();

    // RLS will ensure that only the owner can update their row.
    // We just pass the body to the update.
    const { data, error } = await supabase
      .from('users')
      .update(body)
      .eq('userid', userid)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}
