import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizePerfRow, scoreRow, PERF_THRESHOLDS } from '@/lib/whitelist-performance';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Rank by like-rate desc, then volume — nulls (no swipes) last.
const byRateDesc = (a: { likeRate: number | null; total: number }, b: { likeRate: number | null; total: number }) =>
  (b.likeRate ?? -1) - (a.likeRate ?? -1) || b.total - a.total;

/**
 * GET /api/admin/interests/[key]/members
 * → { data: members[], candidates[] }
 *
 * Every member DH carries its swipe performance (like-rate + verdict from
 * real-user swipes) so ops can spot underperformers, and `candidates` lists the
 * best-performing DHs NOT yet in this category — the decision support that used
 * to live only on the whitelist page, now available for every category.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { key } = await params;

  const { data: rows, error } = await supabaseAdmin
    .from('user_interests')
    .select('user_id, created_at')
    .eq('interest_key', key)
    .order('created_at', { ascending: false });
  if (error) return jsonError(error.message, 500);

  const memberIds = (rows ?? []).map((r) => (r as { user_id: string }).user_id);
  const memberIdSet = new Set(memberIds);

  // Global per-DH swipe performance (DH-only, real-user swipes). One call feeds
  // both the member verdicts and the candidate ranking.
  const { data: perfRaw, error: perfErr } = await supabaseAdmin.rpc('rpc_admin_dh_swipe_performance');
  if (perfErr) return jsonError(perfErr.message, 500);
  const perf = ((perfRaw ?? []) as Array<Record<string, unknown>>).map((r) => scoreRow(normalizePerfRow(r)));
  const perfById = new Map(perf.map((p) => [p.userid, p]));

  // Members — joined to their profile (for avatars) so DHs with no swipes still
  // appear, defaulted to "low data".
  let members: unknown[] = [];
  if (memberIds.length > 0) {
    const { data: users, error: usersErr } = await supabaseAdmin
      .from('users')
      .select('userid, username, avatar, gender, personality, is_digital_human')
      .in('userid', memberIds);
    if (usersErr) return jsonError(usersErr.message, 500);
    members = (users ?? [])
      .map((u) => {
        const p = perfById.get((u as { userid: string }).userid);
        return {
          ...u,
          likes: p?.likes ?? 0,
          dislikes: p?.dislikes ?? 0,
          total: p?.total ?? 0,
          likeRate: p?.likeRate ?? null,
          verdict: p?.verdict ?? 'low data',
        };
      })
      .sort(byRateDesc as (a: { likeRate: number | null; total: number }, b: { likeRate: number | null; total: number }) => number);
  }

  // Candidates — top non-member DHs with enough swipes to judge.
  const candidates = perf
    .filter((p) => !memberIdSet.has(p.userid) && p.total >= PERF_THRESHOLDS.candidateMinSwipes)
    .sort(byRateDesc)
    .slice(0, 40)
    .map((p) => ({
      userid: p.userid,
      username: p.username,
      gender: p.gender,
      personality: p.personality,
      likes: p.likes,
      dislikes: p.dislikes,
      total: p.total,
      likeRate: p.likeRate,
      verdict: p.verdict,
      tier: p.total >= PERF_THRESHOLDS.promoteMinSwipes ? 'proven' : 'promising',
    }));

  return NextResponse.json({ data: members, candidates });
}

/** POST /api/admin/interests/[key]/members  { user_id } — add a member. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { key } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  const userId = (body as { user_id?: unknown })?.user_id;
  if (typeof userId !== 'string' || !userId) return jsonError('user_id is required', 400);

  const { error } = await supabaseAdmin
    .from('user_interests')
    .upsert({ user_id: userId, interest_key: key }, { onConflict: 'user_id,interest_key' });
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/interests/[key]/members?user_id=… — remove a member. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { key } = await params;

  const userId = new URL(req.url).searchParams.get('user_id');
  if (!userId) return jsonError('user_id is required', 400);

  const { error } = await supabaseAdmin
    .from('user_interests')
    .delete()
    .eq('interest_key', key)
    .eq('user_id', userId);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
