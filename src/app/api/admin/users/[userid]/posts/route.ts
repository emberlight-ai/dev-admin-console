import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  const { data, error } = await supabaseAdmin
    .from('user_posts')
    .select('*')
    .eq('userid', userid)
    .order('occurred_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400);

  const b = body as Record<string, unknown>;
  const insertRow = {
    userid,
    photos: [],
    description: typeof b.description === 'string' ? b.description.trim() || null : null,
    occurred_at: typeof b.occurred_at === 'string' ? b.occurred_at : new Date().toISOString(),
    location_name: typeof b.location_name === 'string' ? b.location_name.trim() || null : null,
    longitude: typeof b.longitude === 'number' ? b.longitude : null,
    latitude: typeof b.latitude === 'number' ? b.latitude : null,
    altitude: typeof b.altitude === 'number' ? b.altitude : null,
  };

  const { data, error } = await supabaseAdmin
    .from('user_posts')
    .insert(insertRow)
    .select('*')
    .single();
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ data });
}


