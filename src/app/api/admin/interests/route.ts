import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** GET /api/admin/interests → all interests (incl. hidden) + member counts. */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data: interests, error } = await supabaseAdmin
    .from('interests')
    .select('key, name, asset, sort_order, active, admin_only, category_key, created_at')
    .order('sort_order');
  if (error) return jsonError(error.message, 500);

  const { data: memberRows, error: memErr } = await supabaseAdmin
    .from('user_interests')
    .select('interest_key');
  if (memErr) return jsonError(memErr.message, 500);

  const counts: Record<string, number> = {};
  for (const r of memberRows ?? []) {
    const k = (r as { interest_key: string }).interest_key;
    counts[k] = (counts[k] ?? 0) + 1;
  }

  return NextResponse.json({
    data: (interests ?? []).map((i) => ({ ...i, member_count: counts[i.key] ?? 0 })),
  });
}

/**
 * PATCH /api/admin/interests — batch move/reorder from the kanban board.
 * { updates: [{ key, category_key?, sort_order? }] }
 * One request per drop: a drag renumbers every card whose position changed.
 */
export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const raw = (body as Record<string, unknown>).updates;
  if (!Array.isArray(raw) || raw.length === 0) return jsonError('updates is required', 400);
  if (raw.length > 200) return jsonError('Too many updates', 400);

  const updates: { key: string; patch: Record<string, unknown> }[] = [];
  for (const u of raw) {
    const b = u as Record<string, unknown>;
    if (typeof b.key !== 'string' || !b.key) return jsonError('Each update needs a key', 400);
    const patch: Record<string, unknown> = {};
    if (typeof b.category_key === 'string' && b.category_key.trim()) {
      patch.category_key = b.category_key.trim();
    }
    if (typeof b.sort_order === 'number') patch.sort_order = b.sort_order;
    if (Object.keys(patch).length === 0) return jsonError(`Nothing to update for "${b.key}"`, 400);
    updates.push({ key: b.key, patch });
  }

  const results = await Promise.all(
    updates.map(({ key, patch }) =>
      supabaseAdmin.from('interests').update(patch).eq('key', key)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    if (failed.error.code === '23503') return jsonError('Unknown category', 400);
    return jsonError(failed.error.message, 500);
  }
  return NextResponse.json({ ok: true });
}

/** POST /api/admin/interests  { key, name, asset?, sort_order?, active? } */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const b = body as Record<string, unknown>;
  // Normalize the key to a stable slug (lowercase, underscores) so it can't
  // collide with the iOS keys or contain spaces.
  const rawKey = typeof b.key === 'string' ? b.key : '';
  const key = rawKey.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const asset = typeof b.asset === 'string' && b.asset.trim() ? b.asset.trim() : 'explore_gothic';

  if (!key) return jsonError('key is required', 400);
  if (!name) return jsonError('name is required', 400);

  const { data: maxRow } = await supabaseAdmin
    .from('interests')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort =
    typeof b.sort_order === 'number' ? b.sort_order : ((maxRow?.sort_order ?? 0) + 1);

  const { data, error } = await supabaseAdmin
    .from('interests')
    .insert({
      key,
      name,
      asset,
      sort_order: nextSort,
      active: b.active === false ? false : true,
      category_key: typeof b.category_key === 'string' && b.category_key.trim()
        ? b.category_key.trim()
        : 'unspecified',
    })
    .select('key, name, asset, sort_order, active, admin_only, category_key')
    .single();

  if (error) {
    if (error.code === '23505') return jsonError(`Interest "${key}" already exists`, 409);
    return jsonError(error.message, 500);
  }
  return NextResponse.json({ data });
}
