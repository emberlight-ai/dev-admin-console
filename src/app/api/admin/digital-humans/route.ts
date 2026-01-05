import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type DhRow = {
  userid: string;
  username: string;
  profession?: string | null;
  avatar?: string | null;
  gender?: string | null;
  personality?: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const url = new URL(req.url);
  const gender = (url.searchParams.get('gender') ?? 'all').toLowerCase();
  const personality = url.searchParams.get('personality') ?? 'all';
  const search = (url.searchParams.get('search') ?? '').trim();
  const offset = parseInt(url.searchParams.get('offset') ?? '0') || 0;
  const limit = parseInt(url.searchParams.get('limit') ?? '20') || 20;

  let q = supabaseAdmin
    .from('users')
    .select(
      'userid,username,profession,avatar,gender,personality,created_at,updated_at'
    )
    .eq('is_digital_human', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (gender === 'female') q = q.eq('gender', 'Female');
  if (gender === 'male') q = q.eq('gender', 'Male');
  if (personality !== 'all') q = q.eq('personality', personality);
  if (search) q = q.ilike('username', `${search}%`);

  const { data, error } = await q;
  if (error) return jsonError(error.message, 500);

  const rows = (data ?? []) as DhRow[];
  const ids = rows.map((r) => r.userid);

  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: postRows, error: postErr } = await supabaseAdmin
      .from('user_posts')
      .select('userid')
      .in('userid', ids)
      .is('deleted_at', null);
    if (!postErr) {
      for (const p of postRows ?? []) {
        const id = (p as { userid: string }).userid;
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
  }

  return NextResponse.json({
    data: rows.map((r) => ({ ...r, postsCount: counts[r.userid] ?? 0 })),
  });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  if (!body || typeof body !== 'object')
    return jsonError('Invalid JSON body', 400);
  const b = body as Record<string, unknown>;

  const username = typeof b.username === 'string' ? b.username.trim() : '';
  if (!username) return jsonError('Missing required field: username', 400);

  // Digital humans must have a stable userid (uuid) that aligns with auth.users.id to satisfy FK + enable RLS.
  // We create an Auth user (service-role) with a synthetic email, then update the profile row created by trigger.
  const syntheticEmailLocal =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Date.now());
  const email = `dh_${syntheticEmailLocal}@example.invalid`;
  const password =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `pw_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const { data: createdAuth, error: authErr } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    });
  if (authErr) return jsonError(authErr.message, 500);
  const userId = createdAuth.user?.id;
  if (!userId) return jsonError('Failed to create auth user', 500);

  const updates = {
    username,
    profession:
      typeof b.profession === 'string' ? b.profession.trim() || null : null,
    age: typeof b.age === 'number' ? b.age : null,
    gender: typeof b.gender === 'string' ? b.gender.trim() || null : null,
    personality:
      typeof b.personality === 'string' ? b.personality.trim() || null : null,
    bio: typeof b.bio === 'string' ? b.bio.trim() || null : null,
    is_digital_human: true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('userid', userId)
    .select('userid,username,profession,avatar,gender,created_at,updated_at')
    .maybeSingle();

  if (error) {
    // best-effort cleanup
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return jsonError(error.message, 500);
  }

  return NextResponse.json({ data: data ?? null });
}
