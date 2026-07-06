import { supabaseAdmin } from '@/lib/supabase';

/// Recursively list every object under `prefix` in `bucket` (storage listing is
/// non-recursive, so we do our own folder traversal — same pattern as the
/// hard-delete route's `deleteUserImagesFolder`).
async function listAllObjectPaths(bucket: string, prefix: string): Promise<string[]> {
  const store = supabaseAdmin.storage.from(bucket);
  const limit = 1000;
  const maxPagesPerFolder = 200; // safety cap
  const paths: string[] = [];
  const folderQueue: string[] = [prefix];

  while (folderQueue.length > 0) {
    const folder = folderQueue.shift()!;
    for (let page = 0; page < maxPagesPerFolder; page++) {
      const { data: items, error } = await store.list(folder, {
        limit,
        offset: page * limit,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      if (!items || items.length === 0) break;

      for (const it of items) {
        const isFolder = (it as { id?: string | null }).id == null;
        if (isFolder) {
          folderQueue.push(`${folder}${it.name}/`);
        } else {
          paths.push(`${folder}${it.name}`);
        }
      }
      if (items.length < limit) break;
    }
  }
  return paths;
}

/// Move every object under `fromPrefix` to the same relative path under
/// `toPrefix`, within the same bucket. `.move()` is an atomic rename (no
/// dual-copy window), so the old path is gone the instant this returns —
/// which is what stops a fresh-start re-upload from ever colliding with (and
/// silently overwriting) an archived file at the same key.
///
/// A SECOND delete of the same re-registered identity can itself collide at
/// the archive destination — e.g. a legacy account whose avatar always
/// uploaded to the fixed path `avatar.jpg` gets archived once, the user
/// restores + re-uploads a new `avatar.jpg`, then deletes again: the
/// destination `archived/{uid}/avatar.jpg` is already occupied by the FIRST
/// archive. We must never let that silently drop the second file, so on a
/// destination collision we retry once with a timestamp-suffixed path instead
/// of skipping it.
async function moveFolder(bucket: string, fromPrefix: string, toPrefix: string): Promise<number> {
  const store = supabaseAdmin.storage.from(bucket);
  const paths = await listAllObjectPaths(bucket, fromPrefix);
  let moved = 0;
  for (const fromPath of paths) {
    const toPath = toPrefix + fromPath.slice(fromPrefix.length);
    let { error } = await store.move(fromPath, toPath);
    if (error) {
      const dotIdx = toPath.lastIndexOf('.');
      const suffixedPath =
        dotIdx > toPath.lastIndexOf('/')
          ? `${toPath.slice(0, dotIdx)}.${Date.now()}${toPath.slice(dotIdx)}`
          : `${toPath}.${Date.now()}`;
      ({ error } = await store.move(fromPath, suffixedPath));
      if (error) {
        console.error('[archive-storage] move failed (both attempts)', bucket, fromPath, '->', toPath, error.message);
        continue;
      }
    }
    moved += 1;
  }
  return moved;
}

/// Archives everything a deleted user owns directly: `images/{userId}/` (avatar
/// + post photos, whatever naming scheme uploaded them) moves in one shot to
/// `images/archived/{userId}/`.
export async function archiveUserImagesFolder(userId: string): Promise<number> {
  return moveFolder('images', `${userId}/`, `archived/${userId}/`);
}

/// Chat media isn't organized by user — it's `chat_media/{matchId}/...`, shared
/// by both participants. Archives each of the deleted user's matches' media to
/// `chat_media/archived/{matchId}/`. Safe even though the media is shared: once
/// this user is soft-deleted, the match already disappears from the OTHER
/// participant's live connections list (`deleted_at IS NULL` join filter), so
/// moving it out of the live path doesn't break anything currently visible —
/// it only stops being reachable at its old public URL, which is why every
/// reference to it must be rewritten (see rewriteArchivedUrl below).
export async function archiveMatchMediaFolders(matchIds: string[]): Promise<number> {
  let total = 0;
  for (const matchId of matchIds) {
    total += await moveFolder('chat_media', `${matchId}/`, `archived/${matchId}/`);
  }
  return total;
}

/// A stored `photos`/`avatar`/`media_url` value is a full Supabase Storage
/// public URL (".../storage/v1/object/public/{bucket}/{fromPrefix}..."). After
/// moveFolder relocates the underlying object, any copy we keep of that URL
/// string (in the archive tables) must point at the new path or it 404s.
export function rewriteArchivedUrl(
  url: string | null | undefined,
  bucket: string,
  fromPrefix: string,
  toPrefix: string
): string | null {
  if (!url) return url ?? null;
  const marker = `/storage/v1/object/public/${bucket}/${fromPrefix}`;
  const idx = url.indexOf(marker);
  if (idx === -1) return url; // not a storage URL under this prefix — leave as-is
  return url.slice(0, idx) + `/storage/v1/object/public/${bucket}/${toPrefix}` + url.slice(idx + marker.length);
}
