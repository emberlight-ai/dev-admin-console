import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/** GET: List purchase records for a user (for admin UI / collecting data). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { userid } = await params;

  const { data, error } = await supabaseAdmin
    .from('subscription_purchases')
    .select('id, userid, plan_id, amount_cents, source, original_transaction_id, transaction_id, environment, product_id_apple, created_at')
    .eq('userid', userid)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}
