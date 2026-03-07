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
    .select('id, userid, plan_id, amount_cents, created_at')
    .eq('userid', userid)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

/** POST: Record a purchase in subscription_purchases. Table is for recording each purchase so data can be listed/collected later. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { userid } = await params;

  let body: { plan_id?: string; amount_cents?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const planId =
    typeof body.plan_id === 'string' ? body.plan_id.trim() : undefined;
  const amountCents =
    typeof body.amount_cents === 'number' ? body.amount_cents : undefined;

  if (!planId) {
    return NextResponse.json(
      { error: 'plan_id is required (string)' },
      { status: 400 }
    );
  }
  if (amountCents == null || amountCents < 0 || !Number.isInteger(amountCents)) {
    return NextResponse.json(
      { error: 'amount_cents is required (non-negative integer)' },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from('subscription_purchases')
    .insert({ userid, plan_id: planId, amount_cents: amountCents })
    .select('id, userid, plan_id, amount_cents, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}
