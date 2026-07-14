import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * PATCH /api/admin/skills/[key]
 * { name?, description?, prompt_block?, opener_prompt?, active?, sort_order?, tool_ids? }
 * tool_ids is replace-all on skill_tools (the authorization boundary).
 */
export async function PATCH(
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
  const b = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim();
  if (typeof b.description === 'string') patch.description = b.description.trim() || null;
  if (typeof b.prompt_block === 'string' && b.prompt_block.trim()) patch.prompt_block = b.prompt_block.trim();
  if ('opener_prompt' in b) {
    patch.opener_prompt =
      typeof b.opener_prompt === 'string' && b.opener_prompt.trim() ? b.opener_prompt.trim() : null;
  }
  if (typeof b.active === 'boolean') patch.active = b.active;
  if (typeof b.sort_order === 'number') patch.sort_order = b.sort_order;

  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('skills')
      .update(patch)
      .eq('key', key)
      .select('key')
      .maybeSingle();
    if (error) return jsonError(error.message, 500);
    if (!data) return jsonError('Skill not found', 404);
  }

  // Replace-all tool authorization set.
  if (Array.isArray(b.tool_ids)) {
    const toolIds = [...new Set(b.tool_ids.filter((t): t is string => typeof t === 'string'))];
    const { error: delErr } = await supabaseAdmin.from('skill_tools').delete().eq('skill_key', key);
    if (delErr) return jsonError(delErr.message, 500);
    if (toolIds.length > 0) {
      const { error: insErr } = await supabaseAdmin
        .from('skill_tools')
        .insert(toolIds.map((tool_id) => ({ skill_key: key, tool_id })));
      if (insErr) return jsonError(insErr.message, 500);
    }
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/skills/[key] — dh_skills and skill_tools cascade. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { key } = await params;

  const { error } = await supabaseAdmin.from('skills').delete().eq('key', key);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
