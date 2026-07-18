import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { parseCheckIns, parseTrackers } from '@/lib/skill-trackers';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * PATCH /api/admin/skills/[key]
 * { name?, description?, prompt_block?, opener_prompt?, active?, sort_order?, tool_ids?,
 *   check_in_slots?, check_in_prompt?, trackers? }
 * tool_ids and trackers are replace-all (skill_tools / skill_trackers).
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
  const checkIns = parseCheckIns(b);
  if ('error' in checkIns) return jsonError(checkIns.error, 400);
  Object.assign(patch, checkIns.patch);

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

  // Replace-all tracker declarations, as upsert-then-prune so a failed write
  // never leaves the skill trackerless. Past tracker_entries keep their
  // tracker_key strings, so a removed datapoint stops rendering but its
  // history survives.
  if ('trackers' in b) {
    const trackers = parseTrackers(b.trackers);
    if ('error' in trackers) return jsonError(trackers.error, 400);
    if (Object.keys(patch).length === 0) {
      // Nothing above touched the skills row — confirm the key exists so a
      // bad key 404s instead of surfacing as an FK violation.
      const { data: exists } = await supabaseAdmin.from('skills').select('key').eq('key', key).maybeSingle();
      if (!exists) return jsonError('Skill not found', 404);
    }
    if (trackers.rows.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('skill_trackers')
        .upsert(trackers.rows.map((t) => ({ ...t, skill_key: key })), { onConflict: 'skill_key,key' });
      if (upErr) return jsonError(upErr.message, 500);
    }
    let prune = supabaseAdmin.from('skill_trackers').delete().eq('skill_key', key);
    if (trackers.rows.length > 0) {
      prune = prune.not('key', 'in', `(${trackers.rows.map((t) => `"${t.key}"`).join(',')})`);
    }
    const { error: delErr } = await prune;
    if (delErr) return jsonError(delErr.message, 500);
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
