import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type Params = { params: Promise<{ userid: string }> };

/**
 * GET — the user's conversations for the chat-history rail, sorted by total
 * message count (rpc_admin_user_conversations does the grouping in one query),
 * plus their cooldown row so the UI can render the green "still chatting" dots.
 */
export async function GET(req: NextRequest, { params }: Params) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  const [convRes, cooldownRes] = await Promise.all([
    supabaseAdmin.rpc('rpc_admin_user_conversations', { p_user_id: userid }),
    supabaseAdmin
      .from('user_cooldown')
      .select('active, reason, entered_at')
      .eq('user_id', userid)
      .maybeSingle(),
  ]);

  if (convRes.error) return jsonError(convRes.error.message, 500);
  if (cooldownRes.error) return jsonError(cooldownRes.error.message, 500);

  return NextResponse.json({
    conversations: convRes.data ?? [],
    cooldown: cooldownRes.data ?? null,
  });
}
