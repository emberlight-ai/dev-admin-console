import { supabaseAdmin } from '@/lib/supabase';

/**
 * Shared helpers for the /api/admin/gifts routes: storage upload/removal for
 * gift art and the bundled-asset allowlist. Gift art lives in the public
 * `images` bucket under `gifts/`; gift_catalog.image_url stores the public
 * URL (NULL = bundled iOS asset only).
 */

const BUCKET = 'images';
const PREFIX = 'gifts';
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024;

/** Bundled iOS imagesets a gift can fall back to on builds that predate its
 *  uploaded art (must exist in the app bundle — see Amber asset catalog).
 *  2026-07-22 asset refresh: each of these also has a matching bundled .usdc
 *  3D model (Resources/gifts) keyed by the same base name. */
export const BUNDLED_GIFT_ASSETS = [
  'gift-lolipop', // 2D imageset spelling; the .usdc model is gift-lollipop
  'gift-balloon',
  'gift-juice',
  'gift-lattie',
  'gift-cake',
  'gift-lipstick',
  'gift-bear',
  'gift-roses',
  'gift-ring-box',
] as const;

export const GIFT_COLUMNS = 'key, name, asset, cost_tokens, sort_order, active, image_url, created_at';

function extFor(mime: string) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

/** Upload gift art; returns the public URL. A fresh UUID per upload means a
 *  replaced image gets a NEW URL, so client-side URL caches (Kingfisher) can
 *  never serve stale art. */
export async function uploadGiftImage(key: string, file: File): Promise<{ url?: string; error?: string }> {
  const contentType = file.type || 'application/octet-stream';
  if (!ACCEPTED.has(contentType)) return { error: `Unsupported image type ${contentType}` };
  if (file.size > MAX_BYTES) return { error: 'Image exceeds 8MB' };

  const path = `${PREFIX}/${key}-${crypto.randomUUID()}.${extFor(contentType)}`;
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType });
  if (error) return { error: error.message };

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

/** Best-effort removal of a previously uploaded gift image by its public URL
 *  (only touches objects under our own gifts/ prefix). */
export async function removeGiftImage(publicUrl: string | null | undefined) {
  if (!publicUrl) return;
  const marker = `/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return;
  const path = decodeURIComponent(publicUrl.slice(idx + marker.length));
  if (!path.startsWith(`${PREFIX}/`)) return;
  await supabaseAdmin.storage.from(BUCKET).remove([path]);
}
