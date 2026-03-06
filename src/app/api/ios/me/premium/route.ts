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

/** GET: Get current premium info (is_premium, plan_id, expires_at). Lazy expiration applied. */
export async function GET(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);

    const { data, error } = await supabase.rpc('rpc_get_premium_info', {});

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return NextResponse.json({
        is_premium: false,
        plan_id: null,
        expires_at: null,
      });
    }

    return NextResponse.json({
      is_premium: row.is_premium ?? false,
      plan_id: row.plan_id ?? null,
      expires_at: row.expires_at ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}

/** POST: Purchase premium. Body: { plan_id: string }. Backend computes expires_at from plan (weekly, monthly, yearly). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { plan_id } = body;

    if (!plan_id || typeof plan_id !== 'string' || !plan_id.trim()) {
      return NextResponse.json(
        { error: 'plan_id is required' },
        { status: 400 }
      );
    }

    const supabase = getUserSupabase(req);

    const { data, error } = await supabase.rpc('rpc_purchase_premium', {
      plan_id: plan_id.trim(),
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
