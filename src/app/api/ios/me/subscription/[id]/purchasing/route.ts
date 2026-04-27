import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

/**
 * POST — move subscription CREATED → PURCHASING when StoreKit flow starts (see docs/subscription-design.md).
 * Uses service role after JWT verification so clients cannot set ACTIVE/EXPIRED.
 */
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userSupabase = getUserSupabase(req);
    const { data: userData, error: userErr } = await userSupabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonError(userErr?.message || 'Unauthorized', 401);
    }
    const userId = userData.user.id;
    const { id: subscriptionId } = await params;
    if (!subscriptionId) return jsonError('Missing subscription id', 400);

    const now = new Date().toISOString();
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('subscription')
      .update({
        status: 'PURCHASING',
        status_changed_at: now,
      })
      .eq('id', subscriptionId)
      .eq('user_id', userId)
      .eq('status', 'CREATED')
      .select('id, status, subscription_catalog_id, original_transaction_id, environment')
      .maybeSingle();

    if (updErr) return jsonError(updErr.message, 500);
    if (!updated) {
      return jsonError('Subscription not found or not in CREATED state', 404);
    }

    return NextResponse.json({ subscription: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const POST = withLogging(handlePOST);
