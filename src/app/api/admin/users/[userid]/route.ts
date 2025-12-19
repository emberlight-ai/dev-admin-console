import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('userid', userid)
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ data: data ?? null });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400);

  const updates = body as Record<string, unknown>;
  // Always keep updated_at accurate server-side
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('userid', userid)
    .select('userid,username,profession,age,gender,personality,zipcode,bio,avatar,updated_at')
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ data: data ?? null });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  // Users.userid is aligned to auth.users.id in the schema; delete auth user first so profile/posts cascade.
  const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userid);
  if (authErr) {
    // Fallback: attempt to delete row anyway (useful for legacy rows during migration).
    const { error } = await supabaseAdmin.from('users').delete().eq('userid', userid);
    if (error) return jsonError(error.message, 500);
  }
  return NextResponse.json({ ok: true });
}


