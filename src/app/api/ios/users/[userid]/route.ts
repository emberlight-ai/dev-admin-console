import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  try {
    const { userid } = await params;
    const supabase = getUserSupabase(req);

    // If requesting own profile, standard query.
    // If requesting other profile, use the public view or just the table if RLS permits.
    // The previous schema update allows any auth user to read 'users' table by id.
    
    // We can just query 'users' table directly.
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('userid', userid)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal Server Error' },
      { status: err.message === 'Missing Authorization header' ? 401 : 500 }
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
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal Server Error' },
      { status: err.message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

