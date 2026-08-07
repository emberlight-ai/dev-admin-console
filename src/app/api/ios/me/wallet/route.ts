import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

/**
 * GET /api/ios/me/wallet
 *
 * One bootstrap call for the token UI: balance + gift catalog + token packs.
 * Runs as the caller (user JWT → RLS), so no service key involved.
 */
async function handleGET(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userAuth, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userAuth?.user?.id) {
      return jsonError('Unauthorized', 401);
    }

    const [balanceRes, giftsRes, packsRes] = await Promise.all([
      supabase.rpc('rpc_get_token_balance'),
      supabase
        .from('gift_catalog')
        // cost_tokens_paid and free_for_all are NOT cosmetic extras: the app
        // tiers the confetti moment on the paid price (every cost_tokens is 0
        // while the token IAP is out) and locks the tray on free_for_all.
        // Dropping either here silently disables both — this is the preferred
        // transport, so the client's direct-Supabase fallback never runs.
        .select('key, name, asset, cost_tokens, cost_tokens_paid, free_for_all, sort_order, image_url')
        .eq('active', true)
        .order('sort_order'),
      supabase
        .from('token_catalog')
        .select('id, apple_product_id, name, tokens, bonus_tokens, price_cents, currency, sort_order')
        .eq('active', true)
        .order('sort_order'),
    ]);

    if (balanceRes.error) return jsonError(balanceRes.error.message, 500);
    if (giftsRes.error) return jsonError(giftsRes.error.message, 500);
    if (packsRes.error) return jsonError(packsRes.error.message, 500);

    return NextResponse.json({
      balance: balanceRes.data ?? 0,
      gifts: giftsRes.data ?? [],
      packs: packsRes.data ?? [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const GET = withLogging(handleGET);
