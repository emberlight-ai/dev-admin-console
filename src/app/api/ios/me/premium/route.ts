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

/** GET: Get current premium info (is_premium, plan_id, expires_at, auto_renewal). Driven by Apple IAP + RTDN or app register. */
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
        auto_renewal: true,
      });
    }

    return NextResponse.json({
      is_premium: row.is_premium ?? false,
      plan_id: row.plan_id ?? null,
      expires_at: row.expires_at ?? null,
      auto_renewal: row.auto_renewal ?? true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}
