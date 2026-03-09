import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getPlanConfig,
  getPlanPriceCents,
  getPlanExpiresAt,
} from '@/lib/subscription-plans';

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

/** GET: Get current premium info (is_premium, plan_id, expires_at, auto_renewal). Lazy expiration/auto-renew applied. */
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

/** POST: Purchase premium. Body: { plan_id: string }. Backend uses single plan config (price + duration), records purchase, then grants premium. */
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

    const planConfig = getPlanConfig(plan_id.trim());
    if (!planConfig) {
      return NextResponse.json(
        {
          error: `Unknown plan_id: ${plan_id}. Supported: monthly, yearly, lifetime`,
        },
        { status: 400 }
      );
    }

    const amountCents = getPlanPriceCents(plan_id.trim())!;
    const expiresAt = getPlanExpiresAt(plan_id.trim());
    const expiresAtParam =
      expiresAt == null ? null : expiresAt.toISOString().replace('Z', '');

    const supabase = getUserSupabase(req);

    const { data: purchase, error: recordError } = await supabase.rpc(
      'rpc_record_purchase',
      { plan_id: plan_id.trim(), amount_cents: amountCents }
    );

    if (recordError) {
      return NextResponse.json(
        { error: recordError.message },
        { status: 400 }
      );
    }

    const { data: subscription, error: grantError } = await supabase.rpc(
      'rpc_purchase_premium',
      { plan_id: plan_id.trim(), expires_at: expiresAtParam }
    );

    if (grantError) {
      return NextResponse.json(
        { error: grantError.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      purchase,
      subscription,
      amount_cents: amountCents,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}
