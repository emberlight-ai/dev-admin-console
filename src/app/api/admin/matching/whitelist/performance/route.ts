import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { analyzePerformance, normalizePerfRow, PERF_THRESHOLDS } from '@/lib/whitelist-performance';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// GET — read-only swipe-performance review for the whitelist page: every DH's
// like-rate (from real-user swipes), a verdict for the whitelisted set, promotion
// candidates, and the suggested promote/demote changes (NOT applied here).
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data, error } = await supabaseAdmin.rpc('rpc_admin_dh_swipe_performance');
  if (error) return jsonError(error.message, 500);

  const g = req.nextUrl.searchParams.get('gender');
  const gender = g === 'Female' || g === 'Male' ? g : null;

  let rows = ((data ?? []) as Array<Record<string, unknown>>).map(normalizePerfRow);
  if (gender) rows = rows.filter((r) => (r.gender ?? '').toLowerCase() === gender.toLowerCase());
  const analysis = analyzePerformance(rows);

  return NextResponse.json({ ...analysis, thresholds: PERF_THRESHOLDS });
}
