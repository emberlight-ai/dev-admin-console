import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function deleteUserImagesFolder(userId: string) {
  // Our storage paths are generally `${userId}/...` in the `images` bucket (see schema storage policy).
  const rootPrefix = `${userId}/`;
  const bucket = supabaseAdmin.storage.from('images');

  // Supabase storage listing is non-recursive; implement our own traversal.
  const limit = 1000;
  const maxPagesPerFolder = 200; // safety cap

  const folderQueue: string[] = [rootPrefix];

  while (folderQueue.length > 0) {
    const folder = folderQueue.shift()!;

    for (let page = 0; page < maxPagesPerFolder; page++) {
      const offset = page * limit;
      const { data: items, error } = await bucket.list(folder, {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      if (!items || items.length === 0) break;

      const filePaths: string[] = [];

      for (const it of items) {
        // Heuristic: folders generally have `id: null` and no metadata.
        const isFolder = (it as { id?: string | null }).id == null;
        if (isFolder) {
          folderQueue.push(`${folder}${it.name}/`);
        } else {
          filePaths.push(`${folder}${it.name}`);
        }
      }

      if (filePaths.length > 0) {
        const { error: removeErr } = await bucket.remove(filePaths);
        if (removeErr) throw removeErr;
      }

      if (items.length < limit) break;
    }
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  try {
    // Best-effort: delete user-owned storage objects (not covered by FK cascades).
    try {
      await deleteUserImagesFolder(userid);
    } catch (storageErr: unknown) {
      const msg =
        storageErr instanceof Error ? storageErr.message : 'storage cleanup failed';
      console.warn('[deleteUserImagesFolder] failed:', msg);
    }

    // Hard-delete the Supabase Auth user.
    // This cascades into public.users and all dependent tables via FK ON DELETE CASCADE.
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userid);
    if (delErr) return jsonError(delErr.message, 500);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonError(message, 500);
  }
}

