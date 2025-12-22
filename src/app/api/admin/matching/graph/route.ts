import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type NodeRow = {
  userid: string;
  username: string;
  avatar: string | null;
  is_digital_human: boolean;
};

type EdgeOut =
  | { id: string; kind: 'match'; a: string; b: string; created_at?: string }
  | { id: string; kind: 'pending'; from: string; to: string; created_at?: string }
  | { id: string; kind: 'block'; from: string; to: string; created_at?: string };

function buildOrEqClause(colA: string, colB: string, ids: string[]) {
  const parts: string[] = [];
  for (const id of ids) {
    parts.push(`${colA}.eq.${id}`, `${colB}.eq.${id}`);
  }
  return parts.join(',');
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const url = new URL(req.url);
  const rootUserId = (url.searchParams.get('rootUserId') ?? '').trim();
  const depth = Math.min(Math.max(Number(url.searchParams.get('depth') ?? 1) || 1, 1), 2);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 50), 500);

  if (!rootUserId) return jsonError('Missing query param: rootUserId', 400);

  // Depth 1: edges touching root.
  const ids = new Set<string>([rootUserId]);
  const edges: EdgeOut[] = [];

  const rootOrMatchReq = buildOrEqClause('from_user_id', 'to_user_id', [rootUserId]);
  const rootOrMatches = buildOrEqClause('user_a', 'user_b', [rootUserId]);
  const rootOrBlocks = buildOrEqClause('blocker_id', 'blocked_id', [rootUserId]);

  const [{ data: reqRows, error: reqErr }, { data: matchRows, error: matchErr }, { data: blockRows, error: blockErr }] =
    await Promise.all([
      supabaseAdmin
        .from('match_requests')
        .select('id,from_user_id,to_user_id,created_at')
        .or(rootOrMatchReq)
        .limit(limit),
      supabaseAdmin
        .from('user_matches')
        .select('id,user_a,user_b,created_at')
        .or(rootOrMatches)
        .limit(limit),
      supabaseAdmin
        .from('blocks')
        .select('id,blocker_id,blocked_id,created_at')
        .or(rootOrBlocks)
        .limit(limit),
    ]);

  if (reqErr) return jsonError(reqErr.message, 500);
  if (matchErr) return jsonError(matchErr.message, 500);
  if (blockErr) return jsonError(blockErr.message, 500);

  for (const r of reqRows ?? []) {
    const row = r as { id: string; from_user_id: string; to_user_id: string; created_at?: string };
    ids.add(row.from_user_id);
    ids.add(row.to_user_id);
    edges.push({
      id: `pending-${row.id}`,
      kind: 'pending',
      from: row.from_user_id,
      to: row.to_user_id,
      created_at: row.created_at,
    });
  }
  for (const r of matchRows ?? []) {
    const row = r as { id: string; user_a: string; user_b: string; created_at?: string };
    ids.add(row.user_a);
    ids.add(row.user_b);
    edges.push({
      id: `match-${row.id}`,
      kind: 'match',
      a: row.user_a,
      b: row.user_b,
      created_at: row.created_at,
    });
  }
  for (const r of blockRows ?? []) {
    const row = r as { id: string; blocker_id: string; blocked_id: string; created_at?: string };
    ids.add(row.blocker_id);
    ids.add(row.blocked_id);
    edges.push({
      id: `block-${row.id}`,
      kind: 'block',
      from: row.blocker_id,
      to: row.blocked_id,
      created_at: row.created_at,
    });
  }

  // Depth 2: expand neighbors (bounded) by re-querying edges for the current id set.
  if (depth >= 2) {
    const idList = Array.from(ids).slice(0, 40); // keep query reasonable
    const orMatchReq = buildOrEqClause('from_user_id', 'to_user_id', idList);
    const orMatches = buildOrEqClause('user_a', 'user_b', idList);
    const orBlocks = buildOrEqClause('blocker_id', 'blocked_id', idList);

    const [
      { data: req2, error: req2Err },
      { data: match2, error: match2Err },
      { data: block2, error: block2Err },
    ] = await Promise.all([
      supabaseAdmin.from('match_requests').select('id,from_user_id,to_user_id,created_at').or(orMatchReq).limit(limit),
      supabaseAdmin.from('user_matches').select('id,user_a,user_b,created_at').or(orMatches).limit(limit),
      supabaseAdmin.from('blocks').select('id,blocker_id,blocked_id,created_at').or(orBlocks).limit(limit),
    ]);

    if (req2Err) return jsonError(req2Err.message, 500);
    if (match2Err) return jsonError(match2Err.message, 500);
    if (block2Err) return jsonError(block2Err.message, 500);

    const seenEdgeIds = new Set(edges.map((e) => e.id));

    for (const r of req2 ?? []) {
      const row = r as { id: string; from_user_id: string; to_user_id: string; created_at?: string };
      ids.add(row.from_user_id);
      ids.add(row.to_user_id);
      const id = `pending-${row.id}`;
      if (!seenEdgeIds.has(id)) {
        edges.push({ id, kind: 'pending', from: row.from_user_id, to: row.to_user_id, created_at: row.created_at });
        seenEdgeIds.add(id);
      }
    }
    for (const r of match2 ?? []) {
      const row = r as { id: string; user_a: string; user_b: string; created_at?: string };
      ids.add(row.user_a);
      ids.add(row.user_b);
      const id = `match-${row.id}`;
      if (!seenEdgeIds.has(id)) {
        edges.push({ id, kind: 'match', a: row.user_a, b: row.user_b, created_at: row.created_at });
        seenEdgeIds.add(id);
      }
    }
    for (const r of block2 ?? []) {
      const row = r as { id: string; blocker_id: string; blocked_id: string; created_at?: string };
      ids.add(row.blocker_id);
      ids.add(row.blocked_id);
      const id = `block-${row.id}`;
      if (!seenEdgeIds.has(id)) {
        edges.push({ id, kind: 'block', from: row.blocker_id, to: row.blocked_id, created_at: row.created_at });
        seenEdgeIds.add(id);
      }
    }
  }

  const nodeIds = Array.from(ids).slice(0, 250);
  const { data: users, error: usersErr } = await supabaseAdmin
    .from('users')
    .select('userid,username,avatar,is_digital_human')
    .in('userid', nodeIds)
    .is('deleted_at', null);

  if (usersErr) return jsonError(usersErr.message, 500);

  const nodes = (users ?? []) as NodeRow[];
  return NextResponse.json({ nodes, edges });
}


