import { NextRequest, NextResponse } from 'next/server';
import { getUserSupabase, jsonError } from '@/lib/ios-user-supabase';

export const runtime = 'nodejs';

type Body = {
  subscription_catalog_id?: unknown;
};

/**
 * POST — create purchase intent (`subscription.status = CREATED`) (see docs/subscription-design.md §2.C).
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonError(userErr?.message || 'Unauthorized', 401);
    }
    const userId = userData.user.id;

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return jsonError('Invalid JSON body', 400);
    }

    const catalogId =
      typeof body.subscription_catalog_id === 'string'
        ? body.subscription_catalog_id.trim()
        : '';
    if (!catalogId) return jsonError('subscription_catalog_id is required', 400);

    const { data: cat, error: catErr } = await supabase
      .from('subscription_catalog')
      .select('id')
      .eq('id', catalogId)
      .maybeSingle();

    if (catErr) return jsonError(catErr.message, 500);
    if (!cat) return jsonError('Unknown subscription_catalog_id', 404);

    const now = new Date().toISOString();
    const { data: row, error: insErr } = await supabase
      .from('subscription')
      .insert({
        user_id: userId,
        subscription_catalog_id: catalogId,
        status: 'CREATED',
        status_changed_at: now,
      })
      .select('id, status, subscription_catalog_id, created_at')
      .single();

    if (insErr) return jsonError(insErr.message, 500);

    return NextResponse.json({ subscription: row });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, message === 'Missing Authorization header' ? 401 : 500);
  }
}
