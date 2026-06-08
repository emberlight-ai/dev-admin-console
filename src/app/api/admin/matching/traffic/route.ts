
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    // 1. Check Admin Auth
    if (!isAdminRequest(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = supabaseAdmin;

    const now = new Date();
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // 2. Traffic Stats (Message Counts)
    const getCount = async (since: string) => {
        // We need to specify the FK column because there are multiple relationships to users (sender_id, receiver_id)
        // Syntax: alias:table!fk_column(...)
        const { count, error } = await supabase
            .from('messages')
            .select('id, sender:users!sender_id!inner(is_digital_human)', { count: 'exact', head: true })
            .eq('sender.is_digital_human', true)
            .gt('created_at', since);
            
        if (error) {
            console.error(`Error counting messages since ${since}:`, error);
            throw error;
        }
        return count || 0;
    };

    const [count15m, count1h, count24h] = await Promise.all([
        getCount(fifteenMinutesAgo),
        getCount(oneHourAgo),
        getCount(twentyFourHoursAgo)
    ]);

    // 2b. Best-performing DHs by messages SENT in the selected window (default 24h).
    const url = new URL(req.url);
    const windowParam = url.searchParams.get('window') ?? '24h';
    const windowMs =
      windowParam === '1h' ? 60 * 60 * 1000
      : windowParam === '7d' ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
    const windowSince = new Date(now.getTime() - windowMs).toISOString();

    const { data: dhMsgs, error: dhMsgErr } = await supabase
      .from('messages')
      .select('sender_id, sender:users!sender_id!inner(is_digital_human)')
      .eq('sender.is_digital_human', true)
      .gt('created_at', windowSince);
    if (dhMsgErr) throw dhMsgErr;

    const dhCounts: Record<string, number> = {};
    for (const m of (dhMsgs ?? []) as unknown as Array<{ sender_id: string }>) {
      dhCounts[m.sender_id] = (dhCounts[m.sender_id] ?? 0) + 1;
    }
    const topIds = Object.entries(dhCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id]) => id);

    let topDhs: Array<{ userid: string; username: string; avatar: string | null; personality: string | null; messages: number }> = [];
    if (topIds.length) {
      const { data: topUsers } = await supabase
        .from('users')
        .select('userid, username, avatar, personality')
        .in('userid', topIds);
      const umap = new Map(
        ((topUsers ?? []) as Array<{ userid: string; username: string | null; avatar: string | null; personality: string | null }>).map((u) => [u.userid, u])
      );
      topDhs = topIds.map((id) => ({
        userid: id,
        username: umap.get(id)?.username ?? 'Unknown',
        avatar: umap.get(id)?.avatar ?? null,
        personality: umap.get(id)?.personality ?? null,
        messages: dhCounts[id],
      }));
    }

    // 3. Recent Conversations
    // From user_match_ai_state
    const { data: recent, error: recentError } = await supabase
        .from('user_match_ai_state')
        .select(`
            match_id,
            last_message_at,
            last_message_sender_id,
            match:user_matches!inner (
                user_a,
                user_b
            )
        `)
        .order('last_message_at', { ascending: false })
        .limit(10);

    if (recentError) throw recentError;

    // Enhance recent with User details
    // We need to fetch User A and User B details for each match
    type RecentRow = {
      match_id: string
      last_message_at: string | null
      last_message_sender_id: string | null
      match: { user_a: string; user_b: string }
    }
    type UserRow = { userid: string; username: string | null; is_digital_human: boolean | null; avatar?: string | null; personality?: string | null }

    const detailedRecent = await Promise.all(((recent || []) as unknown as RecentRow[]).map(async (item) => {
        const match = item.match;
        const ids = [match.user_a, match.user_b];
        
        const { data: users } = await supabase
            .from('users')
            .select('userid, username, is_digital_human, avatar, personality') // fetching avatar if exists, or just use ID
            .in('userid', ids);
            
        const typedUsers = (users || []) as unknown as UserRow[]
        const userA = typedUsers.find((u) => u.userid === match.user_a);
        const userB = typedUsers.find((u) => u.userid === match.user_b);
        
        // Fetch snapshot of last message content
        const { data: lastMsg } = await supabase
            .from('messages')
            .select('content')
            .eq('match_id', item.match_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        return {
            ...item,
            user_a_details: userA,
            user_b_details: userB,
            last_message_content: lastMsg?.content || ''
        };
    }));


    return NextResponse.json({
      stats: {
        last_15m: count15m,
        last_1h: count1h,
        last_24h: count24h
      },
      window: windowParam,
      top_dhs: topDhs,
      recent_conversations: detailedRecent
    });

  } catch (error: unknown) {
    console.error('Error fetching traffic stats:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
