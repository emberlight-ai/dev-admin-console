import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** GET /api/admin/interests/[key]/members → the users (DHs) tagged with it. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { key } = await params;

  const { data: rows, error } = await supabaseAdmin
    .from('user_interests')
    .select('user_id, created_at')
    .eq('interest_key', key)
    .order('created_at', { ascending: false });
  if (error) return jsonError(error.message, 500);

  const ids = (rows ?? []).map((r) => (r as { user_id: string }).user_id);
  if (ids.length === 0) return NextResponse.json({ data: [] });

  const { data: users, error: usersErr } = await supabaseAdmin
    .from('users')
    .select('userid, username, avatar, gender, personality, is_digital_human')
    .in('userid', ids);
  if (usersErr) return jsonError(usersErr.message, 500);

  return NextResponse.json({ data: users ?? [] });
}

/** POST /api/admin/interests/[key]/members  { user_id } — add a member. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { key } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  const userId = (body as { user_id?: unknown })?.user_id;
  if (typeof userId !== 'string' || !userId) return jsonError('user_id is required', 400);

  const { error } = await supabaseAdmin
    .from('user_interests')
    .upsert({ user_id: userId, interest_key: key }, { onConflict: 'user_id,interest_key' });
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/interests/[key]/members?user_id=… — remove a member. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { key } = await params;

  const userId = new URL(req.url).searchParams.get('user_id');
  if (!userId) return jsonError('user_id is required', 400);

  const { error } = await supabaseAdmin
    .from('user_interests')
    .delete()
    .eq('interest_key', key)
    .eq('user_id', userId);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
