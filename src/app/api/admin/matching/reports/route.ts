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

type PostLite = {
  id: string;
  description: string | null;
  occurred_at: string | null;
  created_at: string | null;
};

type ReportRow = {
  id: string;
  reason: string | null;
  created_at: string;
  target_post_id: string | null;
  reporter: UserLite | null;
  target_user: UserLite | null;
  post: PostLite | null;
};

type ReportRowRaw = Omit<ReportRow, 'reporter' | 'target_user' | 'post'> & {
  reporter: UserLite | UserLite[] | null;
  target_user: UserLite | UserLite[] | null;
  post: PostLite | PostLite[] | null;
};

function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data, error } = await supabaseAdmin
    .from('reports')
    .select(
      `
      id,
      reason,
      created_at,
      target_post_id,
      reporter:reporter_id(userid,username,avatar,is_digital_human),
      target_user:target_user_id(userid,username,avatar,is_digital_human),
      post:target_post_id(id,description,occurred_at,created_at)
    `
    )
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return jsonError(error.message, 500);

  const rawRows = (data ?? []) as unknown as ReportRowRaw[];
  const rows: ReportRow[] = rawRows.map((r) => ({
    ...r,
    reporter: firstOrNull(r.reporter),
    target_user: firstOrNull(r.target_user),
    post: firstOrNull(r.post),
  }));
  const userReports = rows.filter((r) => !r.target_post_id);
  const postReports = rows.filter((r) => !!r.target_post_id);
  return NextResponse.json({ userReports, postReports });
}


