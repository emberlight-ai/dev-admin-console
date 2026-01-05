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
  const q = (url.searchParams.get('q') ?? '').trim();
  const limitRaw = url.searchParams.get('limit');
  const limit = Math.min(Math.max(Number(limitRaw ?? 20) || 20, 1), 50);

  if (!q) return NextResponse.json({ data: [] });

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('userid,username,avatar,is_digital_human')
    .is('deleted_at', null)
    .ilike('username', `${q}%`)
    .order('username', { ascending: true })
    .limit(limit);

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ data: data ?? [] });
}


