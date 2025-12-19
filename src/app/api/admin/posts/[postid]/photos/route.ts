import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function extFor(contentType: string) {
  if (contentType === 'image/png') return 'png';
  return 'jpg';
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { postid } = await params;

  const form = await req.formData();
  const userId = form.get('userid');
  if (typeof userId !== 'string' || !userId.trim()) return jsonError('Missing userid', 400);

  const files = form.getAll('files').filter((x): x is File => x instanceof File);
  if (files.length === 0) return jsonError('Missing files', 400);

  // Load existing photos to compute next index (best-effort)
  const { data: postRow, error: postErr } = await supabaseAdmin
    .from('user_posts')
    .select('photos')
    .eq('id', postid)
    .maybeSingle();
  if (postErr) return jsonError(postErr.message, 500);

  const existingPhotos = (postRow?.photos ?? []) as string[];
  const existingNumbers = existingPhotos
    .map((u) => {
      const m = u.match(new RegExp(`/post_${postid}/(\\d+)\\.jpg`, 'i'));
      return m ? Number(m[1]) : null;
    })
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const startIndex = (existingNumbers.length ? Math.max(...existingNumbers) : 0) + 1;

  const urls: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const contentType = f.type || 'application/octet-stream';
    if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
      return jsonError('Only image/jpeg or image/png supported', 400);
    }

    const filePath = `${userId}/post_${postid}/${startIndex + i}.${extFor(contentType)}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('images')
      .upload(filePath, f, { upsert: true, contentType });
    if (uploadError) return jsonError(uploadError.message, 500);

    const { data: pub } = supabaseAdmin.storage.from('images').getPublicUrl(filePath);
    urls.push(pub.publicUrl);
  }

  const nextPhotos = [...existingPhotos, ...urls];
  const { error: updErr } = await supabaseAdmin
    .from('user_posts')
    .update({ photos: nextPhotos, updated_at: new Date().toISOString() })
    .eq('id', postid);
  if (updErr) return jsonError(updErr.message, 500);

  return NextResponse.json({ photos: nextPhotos, added: urls });
}


