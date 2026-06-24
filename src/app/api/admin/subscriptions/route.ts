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
  created_at: string | null;
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

/** Normalize an environment query param to the stored value ('Sandbox' | 'Production'), or null for all. */
function normalizeEnvironment(raw: string | null): 'Sandbox' | 'Production' | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'sandbox') return 'Sandbox';
  if (v === 'production') return 'Production';
  return null; // 'all' or unset → no environment filter
}

/**
 * GET — active subscriptions and new-subscription counts for the admin dashboard.
 *
 * Query params:
 *   - environment: 'sandbox' | 'production' (omit for all) — filters every subscription read.
 *   - created_from, created_to (ISO) — when set, the `subscribers` list and new-subscription
 *     counts are restricted to subscriptions created in this window (i.e. when the user subscribed).
 *     `premium_user_ids` is NOT date-restricted, so the Premium tag always reflects current state.
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const url = new URL(req.url);
  const env = normalizeEnvironment(url.searchParams.get('environment'));
  const createdFrom = url.searchParams.get('created_from');
  const createdTo = url.searchParams.get('created_to');

  // Count new subscriptions started within the range, grouped by billing period.
  let newMonthly = 0;
  let newYearly = 0;
  if (createdFrom && createdTo) {
    let nq = supabaseAdmin
      .from('subscription')
      .select('id, created_at, environment, subscription_catalog ( billing_period )')
      .gte('created_at', createdFrom)
      .lte('created_at', createdTo);
    if (env) nq = nq.eq('environment', env);

    const { data: newRows, error: newErr } = await nq;
    if (newErr) return jsonError(newErr.message, 500);

    for (const raw of newRows ?? []) {
      const cat = (raw as unknown as { subscription_catalog: CatalogRow }).subscription_catalog;
      if (cat?.billing_period === 'yearly') newYearly += 1;
      else newMonthly += 1;
    }
  }

  // Every user who has EVER subscribed in this environment — used for cohort
  // conversion (signed up in range AND ever paid). Not date-restricted.
  let paidQuery = supabaseAdmin.from('subscription').select('user_id');
  if (env) paidQuery = paidQuery.eq('environment', env);
  const { data: paidRows, error: paidErr } = await paidQuery;
  if (paidErr) return jsonError(paidErr.message, 500);
  const paidUserIds = Array.from(
    new Set((paidRows ?? []).map((r) => (r as { user_id?: string | null }).user_id).filter(Boolean))
  ) as string[];

  let activeQuery = supabaseAdmin
    .from('subscription')
    .select(
      `
      id,
      user_id,
      status,
      environment,
      created_at,
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

  if (env) activeQuery = activeQuery.eq('environment', env);

  const { data: rows, error } = await activeQuery;

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
    created_at: string | null;
    current_period_end: string | null;
    environment: string | null;
  }> = [];

  // Premium tagging reflects current subscription state and is never date-restricted.
  const premiumUserIds = new Set<string>();
  let totalMrrCents = 0;

  const fromMs = createdFrom ? new Date(createdFrom).getTime() : null;
  const toMs = createdTo ? new Date(createdTo).getTime() : null;

  for (const raw of rows ?? []) {
    const row = raw as unknown as SubRow;
    if (row.status !== 'ACTIVE') continue;
    if (!isSubscriptionActiveNow(row.current_period_end)) continue;

    if (row.user_id) premiumUserIds.add(row.user_id);

    // Restrict the subscribers list to those who subscribed within the date window.
    if (fromMs != null || toMs != null) {
      const createdMs = row.created_at ? new Date(row.created_at).getTime() : NaN;
      if (Number.isNaN(createdMs)) continue;
      if (fromMs != null && createdMs < fromMs) continue;
      if (toMs != null && createdMs > toMs) continue;
    }

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
      created_at: row.created_at,
      current_period_end: row.current_period_end,
      environment: row.environment,
    });
  }

  // Sort by "Renews / ends" descending (furthest-out first); rows without an end date sort last.
  subscribers.sort((a, b) => {
    const ta = a.current_period_end ? new Date(a.current_period_end).getTime() : null;
    const tb = b.current_period_end ? new Date(b.current_period_end).getTime() : null;
    if (ta == null && tb == null) return a.subscription_id.localeCompare(b.subscription_id);
    if (ta == null) return 1;
    if (tb == null) return -1;
    return tb - ta;
  });

  return NextResponse.json({
    monthly_recurring_cents: totalMrrCents,
    active_count: subscribers.length,
    new_monthly: newMonthly,
    new_yearly: newYearly,
    new_total: newMonthly + newYearly,
    environment: env ?? 'all',
    premium_user_ids: Array.from(premiumUserIds),
    paid_user_ids: paidUserIds,
    subscribers,
  });
}
