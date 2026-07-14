import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** GET /api/admin/strategies → the effort presets, in slider order. */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data, error } = await supabaseAdmin
    .from('strategies')
    .select('*')
    .order('sort_order');
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ data: data ?? [] });
}
