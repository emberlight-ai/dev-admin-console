import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Deleted users are now SOFT-deleted (public.users.deleted_at set) rather than
// hard-deleted, so their row — and crucially their subscription — survives. This
// reads the live `users` table for deleted accounts (real users only).
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') ?? 'list').trim(); // list | count

  if (mode === 'count') {
    const { count, error } = await supabaseAdmin
      .from('users')
      .select('userid', { count: 'exact', head: true })
      .not('deleted_at', 'is', null)
      .eq('is_digital_human', false);
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ count: count ?? 0 });
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('userid,username,avatar,gender,age,location_name,created_at,deleted_at')
    .not('deleted_at', 'is', null)
    .eq('is_digital_human', false)
    .order('deleted_at', { ascending: false })
    .limit(1000);

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ data: data ?? [] });
}
