import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') ?? 'list').trim(); // list | count

  if (mode === 'count') {
    const { count, error } = await supabaseAdmin
      .from('user_deletion_audit')
      .select('id', { count: 'exact', head: true });
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ count: count ?? 0 });
  }

  const { data, error } = await supabaseAdmin
    .from('user_deletion_audit')
    .select(
      'id,deleted_user_id,deleted_at,provider,profile_snapshot,usage_snapshot'
    )
    .order('deleted_at', { ascending: false })
    .limit(500);

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ data: data ?? [] });
}
