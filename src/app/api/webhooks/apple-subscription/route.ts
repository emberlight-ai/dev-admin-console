import { decodeJwt } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { dispatchAppleSubscriptionNotification } from '@/lib/apple-subscription-webhook';

export const runtime = 'nodejs';

/**
 * App Store Server Notifications V2.
 * Payload is decoded with jose for dispatch; verify JWS with Apple before full production trust.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    console.warn('[apple-subscription] invalid JSON body');
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || !('signedPayload' in body)) {
    console.warn('[apple-subscription] missing signedPayload');
    return NextResponse.json({ error: 'Missing signedPayload' }, { status: 400 });
  }

  const signedPayload = (body as { signedPayload?: unknown }).signedPayload;
  if (typeof signedPayload !== 'string' || !signedPayload) {
    console.warn('[apple-subscription] signedPayload not a non-empty string');
    return NextResponse.json({ error: 'signedPayload must be a non-empty string' }, { status: 400 });
  }

  try {
    await dispatchAppleSubscriptionNotification(supabaseAdmin, signedPayload);
  } catch (err) {
    console.warn('[apple-subscription] handler error', err);
    if (err instanceof Error && err.message === 'Invalid signedPayload JWT') {
      return NextResponse.json({ error: 'Invalid signedPayload JWT' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
  return NextResponse.json({ ok: true });
}
