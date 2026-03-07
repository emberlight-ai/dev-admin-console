import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/** GET: Get balance for a user (admin only). Returns current free_msgs_today, free_swipe_today and their dates. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { userid } = await params;

  const { data, error } = await supabaseAdmin.rpc('rpc_admin_get_balance', {
    target_userid: userid,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = data as {
    free_msgs_today?: number;
    free_msgs_updated_date?: string | null;
    free_swipe_today?: number;
    free_swipe_updated_date?: string | null;
  } | null;

  if (!row) {
    return NextResponse.json({
      free_msgs_today: 0,
      free_msgs_updated_date: null,
      free_swipe_today: 0,
      free_swipe_updated_date: null,
    });
  }

  return NextResponse.json({
    free_msgs_today: row.free_msgs_today ?? 0,
    free_msgs_updated_date: row.free_msgs_updated_date ?? null,
    free_swipe_today: row.free_swipe_today ?? 0,
    free_swipe_updated_date: row.free_swipe_updated_date ?? null,
  });
}

/** PATCH: Update balance for a user (admin only). Send only fields to update (partial update). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { userid } = await params;

  let body: { free_msgs_today?: number; free_swipe_today?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const free_msgs_today =
    typeof body.free_msgs_today === 'number' ? body.free_msgs_today : undefined;
  const free_swipe_today =
    typeof body.free_swipe_today === 'number' ? body.free_swipe_today : undefined;

  const { data, error } = await supabaseAdmin.rpc('rpc_admin_update_balance', {
    target_userid: userid,
    free_msgs_today: free_msgs_today ?? null,
    free_swipe_today: free_swipe_today ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = data as {
    free_msgs_today?: number;
    free_msgs_updated_date?: string | null;
    free_swipe_today?: number;
    free_swipe_updated_date?: string | null;
  } | null;

  return NextResponse.json({
    free_msgs_today: row?.free_msgs_today ?? 0,
    free_msgs_updated_date: row?.free_msgs_updated_date ?? null,
    free_swipe_today: row?.free_swipe_today ?? 0,
    free_swipe_updated_date: row?.free_swipe_updated_date ?? null,
  });
}
