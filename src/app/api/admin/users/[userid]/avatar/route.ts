import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function avatarExtFor(contentType: string) {
  if (contentType === 'image/png') return 'png';
  return 'jpg';
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError('Missing file', 400);

  const contentType = file.type || 'application/octet-stream';
  if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
    return jsonError('Only image/jpeg or image/png supported', 400);
  }

  const idPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Date.now());
  const filePath = `${userid}/avatar_${idPart}.${avatarExtFor(contentType)}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('images')
    .upload(filePath, file, { upsert: true, contentType });
  if (uploadError) return jsonError(uploadError.message, 500);

  const { data: pub } = supabaseAdmin.storage.from('images').getPublicUrl(filePath);
  const avatarUrl = pub.publicUrl;

  const { error: updErr } = await supabaseAdmin
    .from('users')
    .update({ avatar: avatarUrl, updated_at: new Date().toISOString() })
    .eq('userid', userid);
  if (updErr) return jsonError(updErr.message, 500);

  return NextResponse.json({ avatar: avatarUrl });
}


