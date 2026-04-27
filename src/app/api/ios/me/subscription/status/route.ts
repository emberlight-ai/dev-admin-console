import { NextRequest, NextResponse } from 'next/server';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

/**
 * GET — poll subscription row for long-poll / refresh (see docs/subscription-design.md §2.C).
 * Query: `subscription_id` optional; when omitted, returns the most recently updated row for the user
 * among CREATED, PURCHASING, ACTIVE, EXPIRED.
 */
async function handleGET(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonError(userErr?.message || 'Unauthorized', 401);
    }
    const userId = userData.user.id;
    const subscriptionId = req.nextUrl.searchParams.get('subscription_id')?.trim();

    if (subscriptionId) {
      const { data: row, error } = await supabase
        .from('subscription')
        .select(
          `
          id,
          status,
          original_transaction_id,
          environment,
          current_period_start,
          current_period_end,
          auto_renew_status,
          status_changed_at,
          subscription_catalog_id,
          subscription_catalog (
            id,
            apple_product_id,
            name
          )
        `
        )
        .eq('id', subscriptionId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) return jsonError(error.message, 500);
      if (!row) return jsonError('Not found', 404);
      return NextResponse.json({ subscription: row });
    }

    const { data: rows, error: listErr } = await supabase
      .from('subscription')
      .select(
        `
        id,
        status,
        original_transaction_id,
        environment,
        current_period_start,
        current_period_end,
        auto_renew_status,
        status_changed_at,
        subscription_catalog_id,
        subscription_catalog (
          id,
          apple_product_id,
          name
        )
      `
      )
      .eq('user_id', userId)
      .order('status_changed_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(1);

    if (listErr) return jsonError(listErr.message, 500);
    const row = rows?.[0] ?? null;
    return NextResponse.json({ subscription: row });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const GET = withLogging(handleGET);
