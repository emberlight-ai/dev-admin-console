import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET /api/admin/digital-humans/[id]/interests
 * → { all: [{key,name,sort_order}], selected: string[] }
 *
 * Works for any user id (the M2M is user-agnostic), but is surfaced on the
 * digital-humans admin page to curate which Explore categories a DH shows in.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { id } = await params;

  const [catalogRes, selectedRes] = await Promise.all([
    supabaseAdmin
      .from('interests')
      .select('key, name, sort_order, admin_only')
      .eq('active', true)
      .order('sort_order'),
    supabaseAdmin
      .from('user_interests')
      .select('interest_key')
      .eq('user_id', id),
  ]);

  if (catalogRes.error) return jsonError(catalogRes.error.message, 500);
  if (selectedRes.error) return jsonError(selectedRes.error.message, 500);

  return NextResponse.json({
    all: catalogRes.data ?? [],
    selected: (selectedRes.data ?? []).map((r) => r.interest_key),
  });
}

/**
 * PUT /api/admin/digital-humans/[id]/interests  { keys: string[] }
 * Replace-all semantics, validated against the active catalog.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const rawKeys = (body as { keys?: unknown })?.keys;
  if (!Array.isArray(rawKeys)) return jsonError('Missing keys array', 400);

  const wanted = [...new Set(
    rawKeys.filter((k): k is string => typeof k === 'string').map((k) => k.trim())
  )];

  // Validate against the active catalog so a typo can't violate the FK.
  const { data: catalog, error: catErr } = await supabaseAdmin
    .from('interests')
    .select('key')
    .eq('active', true);
  if (catErr) return jsonError(catErr.message, 500);

  const valid = new Set((catalog ?? []).map((r) => r.key));
  const keys = wanted.filter((k) => valid.has(k));

  const { error: delErr } = await supabaseAdmin
    .from('user_interests')
    .delete()
    .eq('user_id', id);
  if (delErr) return jsonError(delErr.message, 500);

  if (keys.length > 0) {
    const { error: insErr } = await supabaseAdmin
      .from('user_interests')
      .insert(keys.map((key) => ({ user_id: id, interest_key: key })));
    if (insErr) return jsonError(insErr.message, 500);
  }

  return NextResponse.json({ ok: true, selected: keys });
}

/**
 * PATCH /api/admin/digital-humans/[id]/interests  { key: string, enabled: boolean }
 *
 * Toggles ONE tag, additively. Deliberately separate from PUT above: PUT is
 * replace-all, so a caller that only knows about a single tag (the list page's
 * per-row Green Mode switch) would wipe every other tag on that DH.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { key, enabled } = (body ?? {}) as { key?: unknown; enabled?: unknown };
  if (typeof key !== 'string' || !key.trim()) return jsonError('Missing key', 400);
  if (typeof enabled !== 'boolean') return jsonError('Missing enabled', 400);
  const interestKey = key.trim();

  // Same FK guard as PUT: validate against the active catalog.
  const { data: match, error: catErr } = await supabaseAdmin
    .from('interests')
    .select('key')
    .eq('key', interestKey)
    .eq('active', true)
    .maybeSingle();
  if (catErr) return jsonError(catErr.message, 500);
  if (!match) return jsonError(`Unknown interest "${interestKey}"`, 400);

  if (enabled) {
    // Idempotent: the PK is (user_id, interest_key), so a repeat tap is a no-op
    // rather than a duplicate-key error.
    const { error } = await supabaseAdmin
      .from('user_interests')
      .upsert({ user_id: id, interest_key: interestKey }, { onConflict: 'user_id,interest_key' });
    if (error) return jsonError(error.message, 500);
  } else {
    const { error } = await supabaseAdmin
      .from('user_interests')
      .delete()
      .eq('user_id', id)
      .eq('interest_key', interestKey);
    if (error) return jsonError(error.message, 500);
  }

  return NextResponse.json({ ok: true, key: interestKey, enabled });
}
