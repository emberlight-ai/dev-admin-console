import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function noStoreHeaders(contentType: string | null) {
  return {
    'Content-Type': contentType ?? 'application/octet-stream',
    // Prevent browser/proxy caching
    'Cache-Control':
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
  };
}

export async function GET(
  _req: Request,
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

  // NOTE: We add a timestamp query param so the upstream CDN doesn't serve a stale cached avatar.jpg.
  const upstream = `${base}/storage/v1/object/public/images/${userid}/avatar.jpg?t=${Date.now()}`;
  const res = await fetch(upstream, { cache: 'no-store' });

  if (!res.ok) {
    return new NextResponse(null, { status: res.status });
  }

  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    headers: noStoreHeaders(res.headers.get('content-type')),
  });
}
