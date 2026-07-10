import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET ?from=&to= (ISO) — USER-centric chat traffic in the window.
 * Which real users are driving conversation volume (and AI-reply cost), plus
 * the busiest user↔DH conversations. Both come from server-side grouped RPCs
 * (rpc_admin_user_traffic / rpc_admin_traffic_conversations) so we never page
 * the messages table into Node. Defaults to the last 24h if no range given.
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const now = new Date();
  const to = parseDate(req.nextUrl.searchParams.get('to')) ?? now;
  const from =
    parseDate(req.nextUrl.searchParams.get('from')) ??
    new Date(to.getTime() - 24 * 60 * 60 * 1000);

  if (from >= to) return jsonError('`from` must be before `to`', 400);

  const [usersRes, convRes] = await Promise.all([
    supabaseAdmin.rpc('rpc_admin_user_traffic', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    }),
    supabaseAdmin.rpc('rpc_admin_traffic_conversations', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_limit: 12,
    }),
  ]);

  if (usersRes.error) return jsonError(usersRes.error.message, 500);
  if (convRes.error) return jsonError(convRes.error.message, 500);

  const users = (usersRes.data ?? []) as Array<{
    user_id: string;
    username: string | null;
    user_messages: number;
    dh_replies: number;
    active_conversations: number;
    last_active: string | null;
    in_cooldown: boolean;
  }>;

  // Overview is derivable from the per-user rows (conversations partition by
  // real_user_id, so summing active_conversations is the distinct total).
  const overview = users.reduce(
    (acc, u) => {
      acc.active_users += 1;
      acc.user_messages += Number(u.user_messages);
      acc.dh_replies += Number(u.dh_replies);
      acc.active_conversations += Number(u.active_conversations);
      return acc;
    },
    { active_users: 0, user_messages: 0, dh_replies: 0, active_conversations: 0 }
  );

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    overview,
    users,
    conversations: convRes.data ?? [],
  });
}
