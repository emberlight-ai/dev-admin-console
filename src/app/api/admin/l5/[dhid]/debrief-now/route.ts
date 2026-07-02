import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// POST — run the nightly debrief for one DH right now (testing / after edits).
// Proxies to the dh-nightly-debrief edge function with the service key so the
// browser never sees it.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dhid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { dhid } = await params;
  if (!dhid) return jsonError('Missing dhid', 400);

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return jsonError('Supabase env not configured', 500);

  try {
    const res = await fetch(`${url}/functions/v1/dh-nightly-debrief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ dh_user_id: dhid }),
      // Debriefs do a strong-model call + several queries; give it room.
      signal: AbortSignal.timeout(120_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return jsonError(`Debrief failed: ${res.status} ${JSON.stringify(json)}`, 502);
    return NextResponse.json(json);
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
}
