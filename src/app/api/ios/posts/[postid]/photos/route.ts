import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// We need a Service Role client to write to the 'images' bucket if RLS is strict,
// or we can use the user's token if the policy allows. 
// However, the admin route uses `supabaseAdmin` for uploads.
// To be safe and consistent with the admin implementation, we'll verify the user 
// with their token, but perform the upload with the admin client to ensure it succeeds 
// (assuming standard "authenticated users can't overwrite others' files" logic is complex to replicate 
// strictly on just storage policies alone without issues).
//
// ACTUALLY: The safest pattern for "user uploads own content" is:
// 1. Verify Auth (User ID X)
// 2. Verify Ownership (Post Y belongs to User X)
// 3. Upload file to path `X/post_Y/...` using ADMIN client (bypassing specific storage RLS quirks), 
//    OR usage of a properly scoped user client.
// 
// Given the admin route uses `supabaseAdmin`, we will follow suit for the Write operation 
// to ensure reliability, after strictly verifying permission.

const SUBAPASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Admin client for writes
const supabaseAdmin = createClient(SUBAPASE_URL, SUPABASE_SERVICE_KEY);

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
  const { postid } = await params;

  // 1. Verify User
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonError('Missing Authorization header', 401);

  const supabaseUserFn = createClient(SUBAPASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  
  const { data: { user }, error: authErr } = await supabaseUserFn.auth.getUser();
  if (authErr || !user) {
    return jsonError('Unauthorized', 401);
  }

  // 2. Verify Ownership
  const { data: postRow, error: postErr } = await supabaseAdmin
    .from('user_posts')
    .select('id, userid, photos')
    .eq('id', postid)
    .maybeSingle();

  if (postErr) return jsonError(postErr.message, 500);
  if (!postRow) return jsonError('Post not found', 404);

  if (postRow.userid !== user.id) {
    return jsonError('Forbidden: You do not own this post', 403);
  }

  // 3. Process Files
  const form = await req.formData();
  const files = form.getAll('files').filter((x): x is File => x instanceof File);
  
  if (files.length === 0) {
    // It's valid to call this with no files if you just wanted to check permissions, 
    // but usually it's an error. Let's return error.
    return jsonError('Missing files', 400);
  }

  // 4. Calculate Paths
  const existingPhotos = (postRow.photos ?? []) as string[];
  const existingNumbers = existingPhotos
    .map((u) => {
      // Matches: .../post_<id>/<number>.jpg
      const m = u.match(new RegExp(`/post_${postid}/(\\d+)\\.(jpg|png)$`, 'i'));
      return m ? Number(m[1]) : null;
    })
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  
  const startIndex = (existingNumbers.length ? Math.max(...existingNumbers) : 0) + 1;

  const newUrls: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const contentType = f.type || 'application/octet-stream';
    if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
      return jsonError('Only image/jpeg or image/png supported', 400);
    }
    
    // Path: <userid>/post_<postid>/<index>.<ext>
    const filePath = `${user.id}/post_${postid}/${startIndex + i}.${extFor(contentType)}`;
    
    const { error: uploadError } = await supabaseAdmin.storage
      .from('images')
      .upload(filePath, f, { upsert: true, contentType });
    
    if (uploadError) {
      console.error('Upload error:', uploadError);
      return jsonError('Failed to upload image', 500);
    }

    const { data: pub } = supabaseAdmin.storage.from('images').getPublicUrl(filePath);
    newUrls.push(pub.publicUrl);
  }

  // 5. Update Post
  const nextPhotos = [...existingPhotos, ...newUrls];
  const { error: updErr } = await supabaseAdmin
    .from('user_posts')
    .update({ photos: nextPhotos, updated_at: new Date().toISOString() })
    .eq('id', postid);

  if (updErr) return jsonError(updErr.message, 500);

  return NextResponse.json({ 
    success: true,
    photos: nextPhotos, 
    added: newUrls 
  });
}
