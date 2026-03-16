import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/** GET: List subscription purchases. Optional ?source=apple_iap|manual|revenuecat. Returns source, transaction_id, environment, product_id_apple. */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const source = url.searchParams.get('source');
  const sourceFilter =
    source === 'apple_iap' || source === 'manual' || source === 'revenuecat' ? source : null;

  let q = supabaseAdmin
    .from('subscription_purchases')
    .select(
      'id, userid, plan_id, amount_cents, source, original_transaction_id, transaction_id, environment, product_id_apple, created_at, users(username)'
    )
    .order('created_at', { ascending: false });

  if (sourceFilter) {
    q = q.eq('source', sourceFilter);
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type DbRow = {
    id: string;
    userid: string;
    plan_id: string;
    amount_cents: number;
    source: string;
    original_transaction_id: string | null;
    transaction_id: string | null;
    environment: string | null;
    product_id_apple: string | null;
    created_at: string;
    users?: { username?: string } | { username?: string }[] | null;
  };
  const rows = (data ?? []).map((row: DbRow) => ({
    id: row.id,
    userid: row.userid,
    plan_id: row.plan_id,
    amount_cents: row.amount_cents,
    source: row.source,
    original_transaction_id: row.original_transaction_id ?? null,
    transaction_id: row.transaction_id ?? null,
    environment: row.environment ?? null,
    product_id_apple: row.product_id_apple ?? null,
    created_at: row.created_at,
    username: Array.isArray(row.users) ? row.users[0]?.username ?? null : row.users?.username ?? null,
  }));

  return NextResponse.json({ data: rows });
}
