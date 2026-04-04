import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type CatalogRow = {
  name: string;
  apple_product_id: string;
  billing_period: string;
  price_cents: number;
  currency: string;
} | null;

type UserEmbed = {
  userid: string;
  username: string;
  avatar: string | null;
} | null;

type SubRow = {
  id: string;
  user_id: string;
  status: string;
  environment: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  subscription_catalog: CatalogRow;
  users: UserEmbed | UserEmbed[];
};

function isSubscriptionActiveNow(currentPeriodEnd: string | null): boolean {
  if (currentPeriodEnd == null || currentPeriodEnd === '') return true;
  const t = new Date(currentPeriodEnd).getTime();
  if (Number.isNaN(t)) return true;
  return t > Date.now();
}

/** Normalize catalog price to estimated monthly recurring cents (MRR). */
function catalogToMrrCents(catalog: CatalogRow): number {
  if (!catalog) return 0;
  const p = catalog.price_cents ?? 0;
  if (catalog.billing_period === 'yearly') return Math.round(p / 12);
  return p;
}

function unwrapUser(u: UserEmbed | UserEmbed[] | undefined): UserEmbed {
  if (u == null) return null;
  return Array.isArray(u) ? u[0] ?? null : u;
}

/**
 * GET — active subscriptions + estimated MRR for admin dashboard.
 * MRR sums `subscription_catalog.price_cents` per active row: monthly = full price, yearly = price/12.
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data: rows, error } = await supabaseAdmin
    .from('subscription')
    .select(
      `
      id,
      user_id,
      status,
      environment,
      current_period_start,
      current_period_end,
      subscription_catalog (
        name,
        apple_product_id,
        billing_period,
        price_cents,
        currency
      ),
      users (
        userid,
        username,
        avatar
      )
    `
    )
    .eq('status', 'ACTIVE')
    .order('current_period_end', { ascending: false, nullsFirst: true });

  if (error) return jsonError(error.message, 500);

  const subscribers: Array<{
    subscription_id: string;
    user_id: string;
    username: string;
    avatar: string | null;
    plan_name: string;
    apple_product_id: string;
    billing_period: string;
    price_cents: number;
    currency: string;
    monthly_recurring_cents: number;
    current_period_end: string | null;
    environment: string | null;
  }> = [];

  let totalMrrCents = 0;

  for (const raw of rows ?? []) {
    const row = raw as unknown as SubRow;
    if (row.status !== 'ACTIVE') continue;
    if (!isSubscriptionActiveNow(row.current_period_end)) continue;

    const cat = row.subscription_catalog;
    const u = unwrapUser(row.users);
    const mrc = catalogToMrrCents(cat);
    totalMrrCents += mrc;

    subscribers.push({
      subscription_id: row.id,
      user_id: row.user_id,
      username: u?.username?.trim() ? u.username : '—',
      avatar: u?.avatar ?? null,
      plan_name: cat?.name ?? '—',
      apple_product_id: cat?.apple_product_id ?? '—',
      billing_period: cat?.billing_period ?? '—',
      price_cents: cat?.price_cents ?? 0,
      currency: cat?.currency ?? 'USD',
      monthly_recurring_cents: mrc,
      current_period_end: row.current_period_end,
      environment: row.environment,
    });
  }

  subscribers.sort((a, b) => {
    const ua = a.username.toLowerCase();
    const ub = b.username.toLowerCase();
    if (ua !== ub) return ua.localeCompare(ub);
    return a.subscription_id.localeCompare(b.subscription_id);
  });

  return NextResponse.json({
    monthly_recurring_cents: totalMrrCents,
    active_count: subscribers.length,
    subscribers,
  });
}
