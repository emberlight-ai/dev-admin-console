import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// PUT — partial update: enable/disable, edit description/schema/config.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { id } = await params;
  try {
    const body = await req.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
    if (typeof body.description === 'string' && body.description.trim()) updates.description = body.description.trim();
    if (Array.isArray(body.input_schema)) updates.input_schema = body.input_schema;
    if (body.config && typeof body.config === 'object') updates.config = body.config;

    const { data, error } = await supabaseAdmin
      .from('agent_tools')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return jsonError(error.message, 400);
    return NextResponse.json({ tool: data });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Invalid request', 400);
  }
}

// DELETE — remove a tool. Builtins can be deleted from the registry too (the
// implementation stays in code; re-adding is a row insert away).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { id } = await params;
  const { error } = await supabaseAdmin.from('agent_tools').delete().eq('id', id);
  if (error) return jsonError(error.message, 400);
  return NextResponse.json({ ok: true });
}
