import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ postid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { postid } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400);
  const b = body as Record<string, unknown>;

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if ('description' in b) updates.description = typeof b.description === 'string' ? b.description.trim() || null : null;
  if ('occurred_at' in b) updates.occurred_at = typeof b.occurred_at === 'string' ? b.occurred_at : null;
  if ('location_name' in b) updates.location_name = typeof b.location_name === 'string' ? b.location_name.trim() || null : null;
  if ('longitude' in b) updates.longitude = typeof b.longitude === 'number' ? b.longitude : null;
  if ('latitude' in b) updates.latitude = typeof b.latitude === 'number' ? b.latitude : null;
  if ('photos' in b && Array.isArray(b.photos)) updates.photos = b.photos;

  const { data, error } = await supabaseAdmin
    .from('user_posts')
    .update(updates)
    .eq('id', postid)
    .select('*')
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ data: data ?? null });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { postid } = await params;

  const { error } = await supabaseAdmin.from('user_posts').delete().eq('id', postid);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}


