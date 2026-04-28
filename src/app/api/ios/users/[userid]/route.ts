import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withLogging } from '@/lib/with-logging';

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
    location_name: null,
    longitude: null,
    latitude: null,
    notification_enabled: false,
    location_enabled: false,
    created_at: now,
    updated_at: now,
    deleted_at: now,
    is_digital_human: false,
  };
}

function normalizeUserPatch(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid JSON body');
  }

  const input = body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  const optionalTextFields = [
    'username',
    'gender',
    'personality',
    'zipcode',
    'phone',
    'bio',
    'education',
    'profession',
    'avatar',
    'location_name',
  ];

  for (const field of optionalTextFields) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value === null) {
      if (field === 'username') throw new Error('username cannot be null');
      updates[field] = null;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      updates[field] = trimmed || (field === 'username' ? '' : null);
    } else {
      throw new Error(`${field} must be a string`);
    }
  }

  if ('age' in input) {
    const value = input.age;
    if (value === null) {
      updates.age = null;
    } else if (typeof value === 'number' && Number.isInteger(value)) {
      updates.age = value;
    } else {
      throw new Error('age must be an integer');
    }
  }

  for (const field of ['longitude', 'latitude']) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value === null) {
      updates[field] = null;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      if (field === 'longitude' && (value < -180 || value > 180)) {
        throw new Error('longitude must be between -180 and 180');
      }
      if (field === 'latitude' && (value < -90 || value > 90)) {
        throw new Error('latitude must be between -90 and 90');
      }
      updates[field] = value;
    } else {
      throw new Error(`${field} must be a number`);
    }
  }

  for (const field of ['notification_enabled', 'location_enabled']) {
    if (!(field in input)) continue;
    const value = input[field];
    if (typeof value !== 'boolean') {
      throw new Error(`${field} must be a boolean`);
    }
    updates[field] = value;
  }

  return updates;
}

async function handleGET(
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

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  try {
    const { userid } = await params;
    if (!isUuid(userid)) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }
    const supabase = getUserSupabase(req);
    let updates: Record<string, unknown>;
    try {
      updates = normalizeUserPatch(await req.json());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid JSON body';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No supported fields to update' },
        { status: 400 }
      );
    }

    // RLS will ensure that only the owner can update their row.
    const { data, error } = await supabase
      .from('users')
      .update(updates)
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

export const GET = withLogging(handleGET);
export const PATCH = withLogging(handlePATCH);
