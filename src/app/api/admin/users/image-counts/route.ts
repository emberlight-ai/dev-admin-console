import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET — images exchanged between each real user and digital humans, via the
 * rpc_admin_user_dh_image_counts grouped aggregate. Returns a map of
 * userid -> image count (both DH→user selfies and user→DH photos).
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data, error } = await supabaseAdmin.rpc('rpc_admin_user_dh_image_counts');
  if (error) return jsonError(error.message, 500);

  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ user_id?: string | null; image_count?: number | string | null }>) {
    if (!r.user_id) continue;
    counts[r.user_id] = Number(r.image_count ?? 0);
  }

  return NextResponse.json({ data: counts });
}
