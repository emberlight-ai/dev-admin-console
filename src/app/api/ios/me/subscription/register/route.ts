import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getUserSupabase(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Missing Authorization header');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );
}

/**
 * POST: Register Apple subscription after purchase.
 *
 * Only links the user to the Apple subscription (originalTransactionId). Does NOT grant premium
 * or record revenue — that happens when RTDN arrives (Apple's signed notification). This way we
 * never grant premium based on unverified app data; only Apple-confirmed events (RTDN) update
 * user_subscription and subscription_purchases.
 *
 * Body: { originalTransactionId, productId, environment?, bundleId? }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const originalTransactionId =
      typeof body.originalTransactionId === 'string' ? body.originalTransactionId.trim() : null;
    const productId = typeof body.productId === 'string' ? body.productId.trim() : null;
    const environment =
      body.environment === 'Sandbox' || body.environment === 'Production' ? body.environment : null;
    const bundleId = typeof body.bundleId === 'string' ? body.bundleId.trim() || null : null;

    if (!originalTransactionId || !productId) {
      return NextResponse.json(
        { error: 'originalTransactionId and productId are required' },
        { status: 400 }
      );
    }

    const envColumn = environment === 'Sandbox' ? 'Sandbox' : environment === 'Production' ? 'Production' : null;

    const { error: identError } = await supabase.from('apple_subscription_identifiers').upsert(
      {
        userid: user.id,
        original_transaction_id: originalTransactionId,
        environment: envColumn,
        bundle_id: bundleId ?? undefined,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'userid' }
    );

    if (identError) {
      return NextResponse.json({ error: identError.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: 'Subscription linked. Premium will activate when we receive confirmation from Apple (usually within a minute).',
      original_transaction_id: originalTransactionId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}
