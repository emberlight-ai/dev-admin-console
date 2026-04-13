import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt } from 'jose';
import { supabaseAdmin } from '@/lib/supabase';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';

export const runtime = 'nodejs';

function msToIso(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * POST /api/ios/me/subscription/verify
 * Verified via JWS sent from StoreKit 2 client.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userAuth, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userAuth?.user?.id) {
      return jsonError('Unauthorized', 401);
    }
    const userId = userAuth.user.id;
    
    const body = await req.json();
    const jws = body.jwsRepresentation;
    const subscriptionId = body.subscription_id;
    
    if (!jws || typeof jws !== 'string') {
       return jsonError('Missing jwsRepresentation', 400);
    }
    if (!subscriptionId || typeof subscriptionId !== 'string') {
       return jsonError('Missing subscription_id', 400);
    }
    
    let tx: Record<string, unknown>;
    try {
       tx = decodeJwt(jws) as Record<string, unknown>;
    } catch {
       return jsonError('Invalid JWS', 400);
    }
    
    const env = tx.environment === 'Production' ? 'Production' : 'Sandbox';
    const originalTransactionId = typeof tx.originalTransactionId === 'string' ? tx.originalTransactionId : null;
    const productId = typeof tx.productId === 'string' ? tx.productId : '';
    const transactionId = typeof tx.transactionId === 'string' ? tx.transactionId : null;
    
    if (!originalTransactionId || !productId || !transactionId) {
       return jsonError('Missing core transaction fields', 400);
    }
    
    // Look up if this original_transaction_id already belongs to an existing subscription line
    const { data: existingRow } = await supabaseAdmin
       .from('subscription')
       .select('id, user_id')
       .eq('original_transaction_id', originalTransactionId)
       .or(`environment.eq.${env},environment.is.null`)
       .order('updated_at', { ascending: false })
       .limit(1)
       .maybeSingle();
       
    const activeSubId = existingRow ? existingRow.id : subscriptionId;

    const periodStart = msToIso(tx.purchaseDate);
    const periodEnd = msToIso(tx.expiresDate);
    const now = new Date().toISOString();

    // 1. Update the correct subscription row
    const { error: upErr } = await supabaseAdmin.from('subscription').update({
       status: 'ACTIVE',
       environment: env,
       original_transaction_id: originalTransactionId,
       current_period_start: periodStart,
       current_period_end: periodEnd,
       status_changed_at: now
    }).eq('id', activeSubId);
    
    if (upErr) return jsonError(upErr.message, 500);

    // 2. If it's a repurchase and it fell back to the older row, clean up the pending intent row!
    if (existingRow && subscriptionId !== existingRow.id) {
       await supabaseAdmin.from('subscription').delete().eq('id', subscriptionId);
    }

    // 3. Upsert into apple_purchase for idempotency & auditing
    await supabaseAdmin.from('apple_purchase').upsert({
      user_id: existingRow ? existingRow.user_id : userId,
      subscription_id: activeSubId,
      transaction_id: transactionId,
      original_transaction_id: originalTransactionId,
      product_id: productId,
      environment: env,
      purchase_date: periodStart ?? now,
      expires_date: periodEnd,
      quantity: typeof tx.quantity === 'number' ? tx.quantity : 1,
      type: 'auto_renewable',
      raw_payload: { signedTransactionInfo: tx },
    }, {
      onConflict: 'environment,transaction_id',
      ignoreDuplicates: true,
    });

    return NextResponse.json({ ok: true, subscription_id: activeSubId });
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return jsonError(message, 500);
  }
}
