import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET — total messages SENT per user, via the rpc_admin_user_message_counts
 * grouped aggregate. Returns a map of userid -> message count.
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data, error } = await supabaseAdmin.rpc('rpc_admin_user_message_counts');
  if (error) return jsonError(error.message, 500);

  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ user_id?: string | null; message_count?: number | string | null }>) {
    if (!r.user_id) continue;
    counts[r.user_id] = Number(r.message_count ?? 0);
  }

  return NextResponse.json({ data: counts });
}
