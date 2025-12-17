import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Always run this route dynamically; we handle caching via response headers.
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userid: string }> }
) {
  const { userid } = await params;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    return NextResponse.json(
      { error: 'Missing NEXT_PUBLIC_SUPABASE_URL' },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  // If a version is provided, we can safely cache this URL for a long time.
  const v = url.searchParams.get('v');

  // Prefer the user's stored avatar URL (we upload avatars under unique filenames to avoid CDN staleness).
  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('avatar')
    .eq('userid', userid)
    .maybeSingle();

  const avatarUrlRaw = userRow?.avatar?.trim() || null;

  // Fallback to legacy fixed path for older records with no `users.avatar` set.
  const upstream = avatarUrlRaw
    ? avatarUrlRaw
    : `${base}/storage/v1/object/public/images/${userid}/avatar.jpg`;

  // Always fetch upstream with no-store to avoid any intermediate caching issues.
  const res = await fetch(upstream, { cache: 'no-store' });

  if (!res.ok) {
    // If the upstream is missing, send a friendly default avatar.
    if (res.status === 404) {
      return NextResponse.redirect(new URL('/default-avatar.svg', req.url));
    }
    return new NextResponse(null, { status: res.status });
  }

  const buf = await res.arrayBuffer();

  const contentType =
    res.headers.get('content-type') ?? 'application/octet-stream';
  const cacheControl = v
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=60, stale-while-revalidate=86400';

  return new NextResponse(buf, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    },
  });
}
