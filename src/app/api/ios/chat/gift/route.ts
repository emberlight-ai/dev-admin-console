import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

/**
 * POST /api/ios/chat/gift  { match_id, gift_key }
 *
 * Proxies rpc_send_gift as the caller (user JWT → auth.uid() is the sender):
 * atomic wallet debit + gift message + intimacy bump, all server-side.
 * Insufficient balance maps to 402 with a stable error code the client
 * branches on to open the token paywall.
 */
async function handlePOST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userAuth, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userAuth?.user?.id) {
      return jsonError('Unauthorized', 401);
    }

    const body = await req.json().catch(() => ({}));
    const { match_id, gift_key } = body;
    if (!match_id || !gift_key) {
      return jsonError('Missing match_id or gift_key', 400);
    }

    const { data, error } = await supabase.rpc('rpc_send_gift', {
      p_match_id: match_id,
      p_gift_key: gift_key,
    });

    if (error) {
      if (error.message?.includes('insufficient_tokens')) {
        return NextResponse.json({ error: 'insufficient_tokens' }, { status: 402 });
      }
      console.error('rpc_send_gift error:', error);
      return jsonError(error.message, 500);
    }

    // { message, balance }
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}

export const POST = withLogging(handlePOST);
