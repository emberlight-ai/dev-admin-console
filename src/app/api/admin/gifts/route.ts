import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import {
  BUNDLED_GIFT_ASSETS,
  GIFT_COLUMNS,
  removeGiftImage,
  uploadGiftImage,
} from '@/lib/gift-admin';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** GET /api/admin/gifts → full catalog, hidden rows included. */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data, error } = await supabaseAdmin
    .from('gift_catalog')
    .select(GIFT_COLUMNS)
    .order('sort_order');
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ data: data ?? [], bundledAssets: BUNDLED_GIFT_ASSETS });
}

/**
 * POST /api/admin/gifts — create a gift. multipart/form-data:
 *   name (required), cost_tokens (required, int > 0), key? (slug; derived from
 *   name if omitted), asset? (bundled fallback art, default gift-roses),
 *   active? ("true"/"false"), image? (jpeg/png/webp ≤ 8MB)
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError('Expected multipart/form-data', 400);
  }

  const name = String(form.get('name') ?? '').trim();
  if (!name) return jsonError('name is required', 400);

  const rawKey = String(form.get('key') ?? name);
  const key = rawKey.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!key) return jsonError('key is required', 400);

  const costTokens = Number(form.get('cost_tokens'));
  if (!Number.isInteger(costTokens) || costTokens <= 0) {
    return jsonError('cost_tokens must be a positive integer', 400);
  }

  const assetRaw = String(form.get('asset') ?? '').trim();
  const asset = (BUNDLED_GIFT_ASSETS as readonly string[]).includes(assetRaw)
    ? assetRaw
    : 'gift-roses';

  let imageUrl: string | null = null;
  const image = form.get('image');
  if (image instanceof File && image.size > 0) {
    const uploaded = await uploadGiftImage(key, image);
    if (uploaded.error) return jsonError(uploaded.error, 400);
    imageUrl = uploaded.url ?? null;
  }

  const { data: maxRow } = await supabaseAdmin
    .from('gift_catalog')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = await supabaseAdmin
    .from('gift_catalog')
    .insert({
      key,
      name,
      asset,
      cost_tokens: costTokens,
      sort_order: nextSort,
      active: String(form.get('active') ?? 'true') !== 'false',
      image_url: imageUrl,
    })
    .select(GIFT_COLUMNS)
    .single();

  if (error) {
    // Roll back the orphaned upload so storage doesn't accumulate junk.
    await removeGiftImage(imageUrl);
    if (error.code === '23505') return jsonError(`Gift "${key}" already exists`, 409);
    return jsonError(error.message, 500);
  }
  return NextResponse.json({ data });
}

/**
 * PATCH /api/admin/gifts — batch reorder: { updates: [{ key, sort_order }] }.
 * One request per move; the client renumbers every row whose position changed.
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
  if (raw.length > 100) return jsonError('Too many updates', 400);

  const updates: { key: string; sort_order: number }[] = [];
  for (const u of raw) {
    const b = u as Record<string, unknown>;
    if (typeof b.key !== 'string' || !b.key) return jsonError('Each update needs a key', 400);
    if (typeof b.sort_order !== 'number') return jsonError(`sort_order missing for "${b.key}"`, 400);
    updates.push({ key: b.key, sort_order: b.sort_order });
  }

  const results = await Promise.all(
    updates.map(({ key, sort_order }) =>
      supabaseAdmin.from('gift_catalog').update({ sort_order }).eq('key', key)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return jsonError(failed.error.message, 500);
  return NextResponse.json({ ok: true });
}
