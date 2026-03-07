import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/** GET: List all subscription purchases (for admin dashboard). Newest first. */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('subscription_purchases')
    .select('id, userid, plan_id, amount_cents, created_at, users(username)')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = { id: string; userid: string; plan_id: string; amount_cents: number; created_at: string; users?: { username?: string } | null };
  const rows = (data ?? []).map((row: Row) => ({
    id: row.id,
    userid: row.userid,
    plan_id: row.plan_id,
    amount_cents: row.amount_cents,
    created_at: row.created_at,
    username: row.users?.username ?? null,
  }));

  return NextResponse.json({ data: rows });
}
