import { NextRequest, NextResponse } from 'next/server';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import {
  freeTierAppleProductId,
  messageQuotaForPlan,
  remainingMessages,
  remainingSwipes,
  swipeQuotaForPlan,
  utcDayBoundsIso,
  type ActiveSubscriptionRow,
  type SubscriptionCatalogRow,
} from '@/lib/subscription-entitlement';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

function pickActiveSubscription(rows: ActiveSubscriptionRow[]): ActiveSubscriptionRow | null {
  const now = Date.now();
  const active = (rows ?? []).filter((s) => {
    if (!s.current_period_end) return true;
    return new Date(s.current_period_end).getTime() > now;
  });
  if (active.length === 0) return null;
  active.sort((a, b) => {
    const ae = a.current_period_end ? new Date(a.current_period_end).getTime() : Infinity;
    const be = b.current_period_end ? new Date(b.current_period_end).getTime() : Infinity;
    return be - ae;
  });
  return active[0] ?? null;
}

/**
 * GET — remaining swipes/messages and active subscription summary (see docs/subscription-design.md §2.A).
 */
async function handleGET(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonError(userErr?.message || 'Unauthorized', 401);
    }
    const userId = userData.user.id;

    const { data: subsRaw, error: subErr } = await supabase
      .from('subscription')
      .select(
        `
        id,
        status,
        current_period_end,
        subscription_catalog_id,
        subscription_catalog (
          id,
          apple_product_id,
          name,
          swipes_per_day,
          messages_per_day
        )
      `
      )
      .eq('user_id', userId)
      .eq('status', 'ACTIVE');

    if (subErr) return jsonError(subErr.message, 500);

    const subs = (subsRaw ?? []) as unknown as ActiveSubscriptionRow[];
    const activeSub = pickActiveSubscription(subs);
    const catalog: SubscriptionCatalogRow | null = activeSub?.subscription_catalog ?? null;

    let quotaCatalog: SubscriptionCatalogRow | null = catalog;
    if (!quotaCatalog) {
      const { data: freeRow, error: freeErr } = await supabase
        .from('subscription_catalog')
        .select('id, apple_product_id, name, swipes_per_day, messages_per_day')
        .eq('apple_product_id', freeTierAppleProductId())
        .maybeSingle();
      if (freeErr) return jsonError(freeErr.message, 500);
      quotaCatalog = (freeRow as SubscriptionCatalogRow | null) ?? null;
    }

    const swipeQuota = swipeQuotaForPlan(quotaCatalog);
    const messageQuota = messageQuotaForPlan(quotaCatalog);
    const { start, end } = utcDayBoundsIso();

    const swipeCountPromise = supabase
      .from('swipe')
      .select('id', { count: 'exact', head: true })
      .eq('swiper_user_id', userId)
      .gte('created_at', start)
      .lt('created_at', end);

    const messageCountPromise = supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_id', userId)
      .gte('created_at', start)
      .lt('created_at', end);

    const [{ count: swipeUsed, error: swipeErr }, { count: msgUsed, error: msgErr }] =
      await Promise.all([swipeCountPromise, messageCountPromise]);

    if (swipeErr) return jsonError(swipeErr.message, 500);
    if (msgErr) return jsonError(msgErr.message, 500);

    const usedSwipes = swipeUsed ?? 0;
    const usedMessages = msgUsed ?? 0;

    return NextResponse.json({
      remaining_swipes: remainingSwipes(swipeQuota, usedSwipes),
      remaining_messages: remainingMessages(messageQuota, usedMessages),
      subscription: activeSub
        ? {
            id: activeSub.id,
            status: activeSub.status,
            current_period_end: activeSub.current_period_end,
            plan: catalog
              ? {
                  id: catalog.id,
                  name: catalog.name,
                  apple_product_id: catalog.apple_product_id,
                }
              : null,
          }
        : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const GET = withLogging(handleGET);
