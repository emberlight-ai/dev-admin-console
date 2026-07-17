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

/** True if at least one gift message references this catalog key. Gift
 *  bubbles resolve art/name through the catalog row, so a sent gift's row
 *  must never be hard-deleted (hide with active=false instead).
 *  Payloads are jsonb::text, i.e. `"gift": "key"` WITH a space — the
 *  wildcard between colon and value tolerates both spacings (a false match
 *  only blocks a delete, the safe direction). */
async function giftEverSent(key: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('id')
    .eq('type', 'gift')
    .ilike('content', `%"gift":%"${key}"%`)
    .limit(1);
  if (error) return null;
  return (data ?? []).length > 0;
}

/**
 * PATCH /api/admin/gifts/[key]
 *
 * JSON body: { name?, cost_tokens?, active?, asset?, remove_image? } — or
 * multipart/form-data with the same fields plus `image` (jpeg/png/webp ≤ 8MB)
 * to replace the art. `active: false` is the HIDE state: the tray drops the
 * gift on next catalog load and rpc_send_gift refuses it, but history and
 * existing bubbles keep working.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { key } = await params;

  const isMultipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data');

  let fields: Record<string, unknown> = {};
  let image: File | null = null;

  if (isMultipart) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError('Invalid multipart body', 400);
    }
    for (const k of ['name', 'cost_tokens', 'active', 'asset', 'remove_image'] as const) {
      const v = form.get(k);
      if (typeof v === 'string') fields[k] = v;
    }
    const file = form.get('image');
    if (file instanceof File && file.size > 0) image = file;
  } else {
    try {
      fields = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonError('Invalid JSON body', 400);
    }
  }

  const patch: Record<string, unknown> = {};

  if (fields.name != null) {
    const name = String(fields.name).trim();
    if (!name) return jsonError('name cannot be empty', 400);
    patch.name = name;
  }
  if (fields.cost_tokens != null) {
    const cost = Number(fields.cost_tokens);
    if (!Number.isInteger(cost) || cost <= 0) {
      return jsonError('cost_tokens must be a positive integer', 400);
    }
    patch.cost_tokens = cost;
  }
  if (fields.active != null) {
    patch.active = String(fields.active) !== 'false' && fields.active !== false;
  }
  if (fields.asset != null) {
    const asset = String(fields.asset).trim();
    if (!(BUNDLED_GIFT_ASSETS as readonly string[]).includes(asset)) {
      return jsonError('asset must be one of the bundled gift imagesets', 400);
    }
    patch.asset = asset;
  }

  const removeImage = String(fields.remove_image ?? '') === 'true' || fields.remove_image === true;

  // Current row: needed to clean up a replaced/removed image afterwards.
  const { data: existing, error: exErr } = await supabaseAdmin
    .from('gift_catalog')
    .select('key, image_url')
    .eq('key', key)
    .maybeSingle();
  if (exErr) return jsonError(exErr.message, 500);
  if (!existing) return jsonError('Gift not found', 404);

  let uploadedUrl: string | null = null;
  if (image) {
    const uploaded = await uploadGiftImage(key, image);
    if (uploaded.error) return jsonError(uploaded.error, 400);
    uploadedUrl = uploaded.url ?? null;
    patch.image_url = uploadedUrl;
  } else if (removeImage) {
    patch.image_url = null;
  }

  if (Object.keys(patch).length === 0) return jsonError('Nothing to update', 400);

  const { data, error } = await supabaseAdmin
    .from('gift_catalog')
    .update(patch)
    .eq('key', key)
    .select(GIFT_COLUMNS)
    .single();

  if (error) {
    await removeGiftImage(uploadedUrl); // roll back the orphaned upload
    return jsonError(error.message, 500);
  }

  // Old art is unreferenced once the row points elsewhere (or nowhere).
  if ((uploadedUrl || removeImage) && existing.image_url && existing.image_url !== uploadedUrl) {
    await removeGiftImage(existing.image_url);
  }

  return NextResponse.json({ data });
}

/**
 * DELETE /api/admin/gifts/[key] — only for gifts never sent; anything with
 * history must be hidden (active=false) so ledger rows and chat bubbles keep
 * resolving.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { key } = await params;

  const sent = await giftEverSent(key);
  if (sent === null) return jsonError('Could not verify gift history', 500);
  if (sent) {
    return jsonError('This gift has been sent before — hide it instead of deleting', 409);
  }

  const { data, error } = await supabaseAdmin
    .from('gift_catalog')
    .delete()
    .eq('key', key)
    .select('key, image_url')
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError('Gift not found', 404);

  await removeGiftImage(data.image_url);
  return NextResponse.json({ ok: true });
}
