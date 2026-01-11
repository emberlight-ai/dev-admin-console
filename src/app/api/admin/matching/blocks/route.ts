import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type UserLite = {
  userid: string;
  username: string;
  avatar: string | null;
  is_digital_human: boolean;
};

type BlockRow = {
  id: string;
  created_at: string;
  blocker: UserLite | null;
  blocked: UserLite | null;
};

type BlockRowRaw = Omit<BlockRow, 'blocker' | 'blocked'> & {
  blocker: UserLite | UserLite[] | null;
  blocked: UserLite | UserLite[] | null;
};

function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select(
      `
      id,
      created_at,
      blocker:blocker_id(userid,username,avatar,is_digital_human),
      blocked:blocked_id(userid,username,avatar,is_digital_human)
    `
    )
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) return jsonError(error.message, 500);

  const rawRows = (data ?? []) as unknown as BlockRowRaw[];
  const rows: BlockRow[] = rawRows.map((r) => ({
    ...r,
    blocker: firstOrNull(r.blocker),
    blocked: firstOrNull(r.blocked),
  }));

  return NextResponse.json({ blocks: rows });
}

