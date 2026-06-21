import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // safety cap: up to 50k match rows tallied

/**
 * GET — total matches per user, derived from the `user_matches` table.
 * Each match row links `user_a` and `user_b`, so it increments the count for
 * both participants. Returns a map of userid -> match count.
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const counts: Record<string, number> = {};

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabaseAdmin
      .from('user_matches')
      .select('user_a,user_b')
      .range(from, to);

    if (error) return jsonError(error.message, 500);

    const rows = data ?? [];
    for (const r of rows) {
      const a = (r as { user_a?: string | null }).user_a;
      const b = (r as { user_b?: string | null }).user_b;
      if (a) counts[a] = (counts[a] ?? 0) + 1;
      if (b) counts[b] = (counts[b] ?? 0) + 1;
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return NextResponse.json({ data: counts });
}
