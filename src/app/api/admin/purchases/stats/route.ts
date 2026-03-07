import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/** GET: Earnings from subscription_purchases (total and current calendar month). For admin dashboard. */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc('rpc_purchase_earnings_stats');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  const totalCents = Number(row?.total_cents ?? 0);
  const thisMonthCents = Number(row?.this_month_cents ?? 0);

  return NextResponse.json({
    data: {
      total_earnings_cents: totalCents,
      this_month_earnings_cents: thisMonthCents,
    },
  });
}
