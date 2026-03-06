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

/** GET: Get remaining messages (and swipes) info. Uses rpc_get_balance (lazy refill applied). */
export async function GET(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);

    const { data, error } = await supabase.rpc('rpc_get_balance', {});

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return NextResponse.json({
        free_msgs_today: 0,
        free_msgs_updated_date: null,
        free_swipe_today: 0,
        free_swipe_updated_date: null,
      });
    }

    return NextResponse.json({
      free_msgs_today: row.free_msgs_today ?? 0,
      free_msgs_updated_date: row.free_msgs_updated_date ?? null,
      free_swipe_today: row.free_swipe_today ?? 0,
      free_swipe_updated_date: row.free_swipe_updated_date ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

/** PATCH: Update remaining messages (and optionally swipes/dates). Uses rpc_update_balance. */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { free_msgs_today, free_swipe_today } = body;

    const supabase = getUserSupabase(req);

    const { data, error } = await supabase.rpc('rpc_update_balance', {
      free_msgs_today:
        typeof free_msgs_today === 'number' ? free_msgs_today : undefined,
      free_swipe_today:
        typeof free_swipe_today === 'number' ? free_swipe_today : undefined,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data ?? {});
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}
