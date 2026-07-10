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

    // New-customers acquisition: count by created_at regardless of deleted_at — a
    // user acquired in the window still counts even if they later deleted (that's
    // what made the chart go negative for a day when someone deleted).
    const q = supabaseAdmin
      .from('users')
      .select('created_at,is_digital_human')
      .gte('created_at', createdFrom)
      .lte('created_at', createdTo)
      .order('created_at', { ascending: true });

    const { data, error } = await q;
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ data: data ?? [] });
  }

  // mode=list — by default includes deleted users (so they're counted in "new
  // customers" and shown with a red "Deleted" tag); `deleted_at` lets the UI
  // distinguish them. Optional params (all opt-in, backward compatible):
  //   q               — username prefix filter (Real Humans search)
  //   include_deleted — 'false' hides soft-deleted accounts
  //   limit + offset  — paginate (only applied when `limit` is present)
  let q = supabaseAdmin
    .from('users')
    .select('userid,username,gender,age,zipcode,location_name,avatar,created_at,profession,updated_at,is_digital_human,deleted_at,notification_enabled,location_enabled')
    .order('created_at', { ascending: false });

  if (isDigitalBool !== null) q = q.eq('is_digital_human', isDigitalBool);

  const nameQ = (url.searchParams.get('q') ?? '').trim();
  if (nameQ) q = q.ilike('username', `${nameQ}%`);

  if (url.searchParams.get('include_deleted') === 'false') q = q.is('deleted_at', null);

  // Optional account-creation window (used by the admin Users page date filter).
  const listCreatedFrom = url.searchParams.get('created_from');
  const listCreatedTo = url.searchParams.get('created_to');
  if (listCreatedFrom) q = q.gte('created_at', listCreatedFrom);
  if (listCreatedTo) q = q.lte('created_at', listCreatedTo);

  const limitRaw = url.searchParams.get('limit');
  if (limitRaw) {
    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 100);
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);
    q = q.range(offset, offset + limit - 1);
  }

  const { data, error } = await q;
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ data: data ?? [] });
}


