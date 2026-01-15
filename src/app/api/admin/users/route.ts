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
  const mode = (url.searchParams.get('mode') ?? 'list').trim(); // list | chart | count | search
  const isDigital = url.searchParams.get('is_digital_human');

  const isDigitalBool =
    isDigital == null
      ? null
      : isDigital === 'true'
        ? true
        : isDigital === 'false'
          ? false
          : null;

  if (mode === 'count') {
    let q = supabaseAdmin
      .from('users')
      .select('userid', { count: 'exact', head: true });
    if (isDigitalBool !== null) q = q.eq('is_digital_human', isDigitalBool);
    q = q.is('deleted_at', null);

    const { count, error } = await q;
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ count: count ?? 0 });
  }

  if (mode === 'search') {
    const q = (url.searchParams.get('q') ?? '').trim();
    const limitRaw = url.searchParams.get('limit');
    const limit = Math.min(Math.max(Number(limitRaw ?? 20) || 20, 1), 50);
    if (!q) return NextResponse.json({ data: [] });

    let qq = supabaseAdmin
      .from('users')
      .select('userid,username,avatar,is_digital_human,deleted_at')
      .is('deleted_at', null)
      .ilike('username', `${q}%`)
      .order('username', { ascending: true })
      .limit(limit);

    if (isDigitalBool !== null) qq = qq.eq('is_digital_human', isDigitalBool);

    const { data, error } = await qq;
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ data: data ?? [] });
  }

  if (mode === 'chart') {
    const createdFrom = url.searchParams.get('created_from');
    const createdTo = url.searchParams.get('created_to');
    if (!createdFrom || !createdTo) {
      return jsonError('Missing required query params: created_from, created_to', 400);
    }

    const q = supabaseAdmin
      .from('users')
      .select('created_at,is_digital_human')
      .gte('created_at', createdFrom)
      .lte('created_at', createdTo)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    const { data, error } = await q;
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ data: data ?? [] });
  }

  // mode=list
  let q = supabaseAdmin
    .from('users')
    .select('userid,username,gender,age,zipcode,avatar,created_at,profession,updated_at,is_digital_human')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (isDigitalBool !== null) q = q.eq('is_digital_human', isDigitalBool);

  const { data, error } = await q;
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ data: data ?? [] });
}


