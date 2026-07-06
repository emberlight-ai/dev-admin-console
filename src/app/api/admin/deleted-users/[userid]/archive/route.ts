import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/// Full preserved history for one deleted user: posts (with photos), matches,
/// and complete message transcripts — populated by archiveUserContent()
/// (src/lib/account-reset.ts) at delete time. Grouped by match so the admin
/// page can render one conversation thread per match, newest first.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  const [postsRes, matchesRes] = await Promise.all([
    supabaseAdmin
      .from('archived_user_posts')
      .select('*')
      .eq('deleted_user_id', userid)
      .order('occurred_at', { ascending: false }),
    supabaseAdmin
      .from('archived_user_matches')
      .select('*')
      .eq('deleted_user_id', userid)
      .order('created_at', { ascending: false }),
  ]);
  if (postsRes.error) return jsonError(postsRes.error.message, 500);
  if (matchesRes.error) return jsonError(matchesRes.error.message, 500);

  const matches = matchesRes.data ?? [];
  const matchIds = matches.map((m) => m.id as string);

  let messagesByMatch = new Map<string, unknown[]>();
  if (matchIds.length > 0) {
    const { data: messages, error: messagesErr } = await supabaseAdmin
      .from('archived_messages')
      .select('*')
      .in('match_id', matchIds)
      .order('created_at', { ascending: true });
    if (messagesErr) return jsonError(messagesErr.message, 500);

    messagesByMatch = (messages ?? []).reduce((map, msg) => {
      const key = msg.match_id as string;
      const list = map.get(key) ?? [];
      list.push(msg);
      map.set(key, list);
      return map;
    }, new Map<string, unknown[]>());
  }

  const conversations = matches.map((m) => ({
    match: m,
    messages: messagesByMatch.get(m.id as string) ?? [],
  }));

  return NextResponse.json({
    data: {
      posts: postsRes.data ?? [],
      conversations,
    },
  });
}
