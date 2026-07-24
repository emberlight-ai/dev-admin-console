import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * PATCH /api/admin/interests/[key]  { name?, asset?, sort_order?, active? }
 * `active: false` is the HIDE state (iOS reads active=true only) — a soft,
 * reversible alternative to DELETE that keeps existing taggings.
 */
export async function PATCH(
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

  const b = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof b.name === 'string') patch.name = b.name.trim();
  if (typeof b.asset === 'string' && b.asset.trim()) patch.asset = b.asset.trim();
  if (typeof b.sort_order === 'number') patch.sort_order = b.sort_order;
  if (typeof b.active === 'boolean') patch.active = b.active;
  if (typeof b.admin_only === 'boolean') patch.admin_only = b.admin_only;
  // Move an interest to a different category (validated against the FK).
  if (typeof b.category_key === 'string' && b.category_key.trim()) {
    patch.category_key = b.category_key.trim();
  }

  if (Object.keys(patch).length === 0) return jsonError('Nothing to update', 400);

  const { data, error } = await supabaseAdmin
    .from('interests')
    .update(patch)
    .eq('key', key)
    .select('key, name, asset, sort_order, active, admin_only, category_key')
    .maybeSingle();

  if (error?.code === '23503') return jsonError('Unknown category', 400);

  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError('Interest not found', 404);
  return NextResponse.json({ data });
}

/**
 * DELETE /api/admin/interests/[key]
 * Hard delete. user_interests rows cascade (FK on delete cascade). Prefer
 * PATCH active:false to hide without losing taggings.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { key } = await params;

  // Internal-control interests must survive (Whitelist backs the home deck,
  // Green Mode backs the green-mode filter).
  if (key === 'featured' || key === 'whitelist' || key === 'green_mode') {
    return jsonError('This is an internal interest and cannot be deleted', 400);
  }

  const { error } = await supabaseAdmin.from('interests').delete().eq('key', key);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
