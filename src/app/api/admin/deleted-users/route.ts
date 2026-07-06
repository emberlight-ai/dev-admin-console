import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Deleted users are SOFT-deleted (public.users.deleted_at set) so the row —
// and crucially their subscription — survives, but the delete flow also WIPES
// every profile field on that live row (fresh-start restore guarantee: a
// returning sign-in with the same identity gets a blank account, not their old
// one). So username/avatar/gender/age/location can no longer be read off the
// live row — they come from the latest user_deletion_audit snapshot captured
// at the moment of deletion instead. The full history (posts, matches, chat)
// lives in the archived_* tables — see /api/admin/deleted-users/[userid]/archive.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') ?? 'list').trim(); // list | count

  if (mode === 'count') {
    const { count, error } = await supabaseAdmin
      .from('users')
      .select('userid', { count: 'exact', head: true })
      .not('deleted_at', 'is', null)
      .eq('is_digital_human', false);
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ count: count ?? 0 });
  }

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('userid,created_at,deleted_at')
    .not('deleted_at', 'is', null)
    .eq('is_digital_human', false)
    .order('deleted_at', { ascending: false })
    .limit(1000);
  if (error) return jsonError(error.message, 500);

  const userIds = (users ?? []).map((u) => u.userid as string);
  const snapshotByUser = new Map<
    string,
    { username: string | null; avatar: string | null; gender: string | null; age: number | null; location_name: string | null }
  >();

  if (userIds.length > 0) {
    // Multiple audits can exist per user (delete -> restore -> delete again),
    // so pull every row and keep only the newest per user.
    const { data: audits, error: auditErr } = await supabaseAdmin
      .from('user_deletion_audit')
      .select('deleted_user_id, deleted_at, profile_snapshot')
      .in('deleted_user_id', userIds)
      .order('deleted_at', { ascending: false });
    if (auditErr) return jsonError(auditErr.message, 500);

    for (const row of audits ?? []) {
      const uid = row.deleted_user_id as string;
      if (snapshotByUser.has(uid)) continue; // already have the newest (rows are desc)
      const snap = (row.profile_snapshot ?? {}) as Record<string, unknown>;
      snapshotByUser.set(uid, {
        username: (snap.username as string) ?? null,
        avatar: (snap.avatar as string) ?? null,
        gender: (snap.gender as string) ?? null,
        age: (snap.age as number) ?? null,
        location_name: (snap.location_name as string) ?? null,
      });
    }
  }

  const data = (users ?? []).map((u) => {
    const snap = snapshotByUser.get(u.userid as string);
    return {
      userid: u.userid,
      created_at: u.created_at,
      deleted_at: u.deleted_at,
      username: snap?.username ?? null,
      avatar: snap?.avatar ?? null,
      gender: snap?.gender ?? null,
      age: snap?.age ?? null,
      location_name: snap?.location_name ?? null,
    };
  });

  return NextResponse.json({ data });
}
