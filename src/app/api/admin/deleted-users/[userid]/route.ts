import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  const { data, error } = await supabaseAdmin
    .from('user_deletion_audit')
    .select('*')
    .eq('deleted_user_id', userid)
    .order('deleted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ data: data ?? null });
}
