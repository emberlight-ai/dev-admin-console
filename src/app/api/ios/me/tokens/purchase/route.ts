import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt } from 'jose';
import { supabaseAdmin } from '@/lib/supabase';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

/**
 * POST /api/ios/me/tokens/purchase
 *
 * Credits a consumable token pack after a StoreKit 2 purchase. The client
 * sends the signed transaction (jwsRepresentation); we look the product up in
 * token_catalog and credit tokens + bonus_tokens via fn_token_credit.
 *
 * Idempotent: fn_token_credit keys on (reason='iap_purchase',
 * ref=`${environment}:${transactionId}`), so StoreKit unfinished-transaction
 * replays and client retries credit exactly once.
 */
async function handlePOST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userAuth, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userAuth?.user?.id) {
      return jsonError('Unauthorized', 401);
    }
    const userId = userAuth.user.id;

    const body = await req.json().catch(() => ({}));
    const jws = body.jwsRepresentation;
    if (!jws || typeof jws !== 'string') {
      return jsonError('Missing jwsRepresentation', 400);
    }

    let tx: Record<string, unknown>;
    try {
      tx = decodeJwt(jws) as Record<string, unknown>;
    } catch {
      return jsonError('Invalid JWS', 400);
    }

    const env = tx.environment === 'Production' ? 'Production' : 'Sandbox';
    const productId = typeof tx.productId === 'string' ? tx.productId : '';
    const transactionId = typeof tx.transactionId === 'string' ? tx.transactionId : null;
    if (!productId || !transactionId) {
      return jsonError('Missing core transaction fields', 400);
    }

    const { data: pack, error: packErr } = await supabaseAdmin
      .from('token_catalog')
      .select('id, apple_product_id, tokens, bonus_tokens, active')
      .eq('apple_product_id', productId)
      .maybeSingle();

    if (packErr) return jsonError(packErr.message, 500);
    if (!pack || !pack.active) {
      return jsonError(`Unknown token product: ${productId}`, 400);
    }

    const amount = (pack.tokens ?? 0) + (pack.bonus_tokens ?? 0);
    const ref = `${env}:${transactionId}`;

    const { data: balance, error: creditErr } = await supabaseAdmin.rpc('fn_token_credit', {
      p_user: userId,
      p_amount: amount,
      p_reason: 'iap_purchase',
      p_ref: ref,
    });

    if (creditErr) return jsonError(creditErr.message, 500);

    return NextResponse.json({
      ok: true,
      credited: amount,
      balance: balance ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const POST = withLogging(handlePOST);
